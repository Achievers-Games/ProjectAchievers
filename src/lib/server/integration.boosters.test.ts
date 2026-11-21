// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BOOSTER_PRICE } from '#lib/boosters';
import { db } from './db';
import {
  BoosterError,
  boosterState,
  collectionPage,
  collectionSummary,
  decodeCursor,
  openBooster,
} from './boosters';
import { profileCardBanner, resolveCardBanner } from './card-banner';
import { syncCardCatalogue } from './card-catalogue';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();
// Les éditions ne dépendent d'aucun jeu : le nettoyage commun ne les voit pas.
// Supprimer la famille supprime ses éditions.
afterAll(() => db.cardFamily.deleteMany({ where: { familyKey: { startsWith: PREFIX } } }));
// Tous les joueurs tirent dans le même catalogue : chaque test part d'un catalogue vide, pour
// savoir exactement ce qui peut sortir.
beforeEach(async () => {
  await db.cardFamily.deleteMany({ where: { familyKey: { startsWith: PREFIX } } });
  await db.cardFamily.updateMany({ where: { enabled: true }, data: { enabled: false } });
});

async function player(shards = 0) {
  return db.user.create({
    data: { handle: `${PREFIX}-${Math.random()}`, displayName: `${PREFIX} joueur`, shards },
  });
}

/** Un jeu au catalogue, avec une édition Relief ; le joueur n'y a encore jamais joué. */
async function catalogueGameWithRelief(options: { adultOnly?: boolean } = {}) {
  const familyKey = `${PREFIX}-${Math.random()}`;
  const game = await upsertGame({
    platform: 'STEAM',
    platformGameId: familyKey,
    name: `${PREFIX} jeu`,
  });
  await db.game.update({
    where: { id: game.id },
    data: { familyKey, familyLocked: true, adultOnly: options.adultOnly ?? false },
  });
  const edition = await db.gameEdition.create({
    data: {
      kind: 'RELIEF',
      assetPath: `/cartes/${familyKey}/1`,
      family: { create: { familyKey, enabled: true } },
    },
  });
  return { game, edition };
}

/** Un jeu joué par le joueur, avec une édition Relief. */
async function playedGameWithRelief(userId: string) {
  const { game, edition } = await catalogueGameWithRelief();
  await saveAchievements(game.id, [
    {
      platformAchievementId: 'a',
      name: 'A',
      description: '',
      hidden: false,
      trophyType: 'ACHIEVEMENT',
    },
    {
      platformAchievementId: 'b',
      name: 'B',
      description: '',
      hidden: false,
      trophyType: 'ACHIEVEMENT',
    },
  ]);
  // Un succès d'avant les éclats : il rend le jeu tirable sans rien rapporter.
  await saveProgress(userId, game.id, [
    { platformAchievementId: 'a', unlockedAt: new Date('2020-01-01') },
  ]);
  return { game, edition };
}

describe('ouverture d’un booster', () => {
  it('consomme le booster offert et donne l’édition, puis des doublons', async () => {
    const user = await player();
    const { edition } = await playedGameWithRelief(user.id);

    const opened = await openBooster(user.id, 'DAILY');
    expect(opened.cards).toHaveLength(5);
    // Une seule édition possible : la première est nouvelle, les quatre autres sont des doublons.
    expect(opened.cards.map((card) => card.duplicate)).toEqual([false, true, true, true, true]);
    expect(await db.userEdition.count({ where: { userId: user.id, editionId: edition.id } })).toBe(
      1,
    );

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.shards).toBe(4);
    expect(after.boostersOpened).toBe(1);

    // Plus de booster offert aujourd'hui.
    await expect(openBooster(user.id, 'DAILY')).rejects.toThrow(BoosterError);
  });

  it('achète un booster avec des éclats, jamais à découvert', async () => {
    const user = await player(BOOSTER_PRICE);
    await playedGameWithRelief(user.id);

    await openBooster(user.id, 'SHARDS');
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    // Le prix est débité, puis la première édition est nouvelle et quatre doublons rendent 1 chacun.
    expect(after.shards).toBe(4);
    await expect(openBooster(user.id, 'SHARDS')).rejects.toMatchObject({ code: 'no_shards' });

    const ledger = await db.shardEntry.aggregate({
      where: { userId: user.id },
      _sum: { delta: true },
    });
    expect(BOOSTER_PRICE + (ledger._sum.delta ?? 0)).toBe(after.shards);
  });

  it('ne s’ouvre pas tant que le temps de jeu Steam est privé', async () => {
    const user = await player(BOOSTER_PRICE);
    await playedGameWithRelief(user.id);
    const account = await db.linkedAccount.create({
      data: {
        userId: user.id,
        provider: 'STEAM',
        providerUserId: `${PREFIX}-${Math.random()}`,
        displayName: PREFIX,
        playtimeHidden: true,
      },
    });
    expect(await boosterState(user.id)).toMatchObject({ playtimeHidden: true });
    await expect(openBooster(user.id, 'DAILY')).rejects.toMatchObject({ code: 'playtime_hidden' });
    await expect(openBooster(user.id, 'SHARDS')).rejects.toMatchObject({
      code: 'playtime_hidden',
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).shards).toBe(
      BOOSTER_PRICE,
    );

    await db.linkedAccount.update({ where: { id: account.id }, data: { playtimeHidden: false } });
    await expect(openBooster(user.id, 'DAILY')).resolves.toBeTruthy();
  });

  it('ne s’ouvre pas sans édition possible, et écarte les jeux réservés aux adultes', async () => {
    const user = await player(100);
    await catalogueGameWithRelief({ adultOnly: true });

    expect((await boosterState(user.id)).canDraw).toBe(false);
    await expect(openBooster(user.id, 'SHARDS')).rejects.toMatchObject({ code: 'no_cards' });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).shards).toBe(100);
  });

  it('tire aussi les cartes des jeux que le joueur n’a pas', async () => {
    const user = await player();
    const { edition } = await catalogueGameWithRelief();

    const opened = await openBooster(user.id, 'DAILY');
    expect(opened.cards.every((card) => card.editionId === edition.id)).toBe(true);
    expect(await collectionSummary(user.id)).toMatchObject({ owned: { RELIEF: 1 } });
    // Sans le jeu fini à 100 %, la carte reste dans la collection, pas en bannière.
    expect(await resolveCardBanner(user.id, edition.id)).toBeNull();
  });

  it('ne débite jamais deux fois sous des ouvertures simultanées', async () => {
    const user = await player(BOOSTER_PRICE);
    await playedGameWithRelief(user.id);

    const results = await Promise.allSettled([
      openBooster(user.id, 'SHARDS'),
      openBooster(user.id, 'SHARDS'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).shards,
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('la collection', () => {
  it('réserve la bannière aux cartes possédées de jeux terminés et visibles', async () => {
    const user = await player();
    const other = await player();
    const { game, edition } = await playedGameWithRelief(user.id);
    await openBooster(user.id, 'DAILY');
    expect(await resolveCardBanner(user.id, edition.id)).toBeNull();

    await db.userGame.updateMany({
      where: { userId: user.id, gameId: game.id },
      data: { completion: 100 },
    });
    expect(await resolveCardBanner(other.id, edition.id)).toBeNull();
    await db.user.update({
      where: { id: user.id },
      data: { bannerEditionId: edition.id },
    });
    // L'image fixe est celle de l'édition, pas le visuel Steam du jeu.
    expect(await profileCardBanner(user.id)).toMatchObject({
      kind: 'RELIEF',
      game: { slug: game.slug, headerUrl: `${edition.assetPath}/full.jpg` },
    });

    await db.userGame.updateMany({
      where: { userId: user.id, gameId: game.id },
      data: { hidden: true },
    });
    expect(await profileCardBanner(user.id)).toBeNull();
  });

  it('montre les cartes obtenues et compte celles qui restent à découvrir', async () => {
    const user = await player();
    const { game, edition } = await playedGameWithRelief(user.id);

    expect(await collectionSummary(user.id)).toEqual({
      owned: { RELIEF: 0, VIVANTE: 0, MYTHIQUE: 0 },
      missing: { RELIEF: 1, VIVANTE: 0, MYTHIQUE: 0 },
    });
    expect((await collectionPage(user.id)).cards).toEqual([]);

    await openBooster(user.id, 'DAILY');
    const summary = await collectionSummary(user.id);
    // Les doublons du même booster ne créent pas de seconde carte.
    expect(summary.owned.RELIEF).toBe(1);
    expect(summary.missing.RELIEF).toBe(0);
    const page = await collectionPage(user.id);
    expect(page.next).toBeNull();
    expect(page.cards).toHaveLength(1);
    expect(page.cards[0]).toMatchObject({
      editionId: edition.id,
      kind: 'RELIEF',
      game: { slug: game.slug, headerUrl: `${edition.assetPath}/full.jpg` },
    });
    // Un seul propriétaire : la carte est comptée une fois, même tirée cinq fois.
    expect((await db.gameEdition.findUniqueOrThrow({ where: { id: edition.id } })).ownerCount).toBe(
      1,
    );
    expect(page.cards[0]!.ownerShare).toBeGreaterThan(0);
  });

  it('lit la collection par pages, filtrée par rareté et par nom de jeu', async () => {
    const user = await player();
    const editions = [];
    for (let i = 0; i < 5; i++) editions.push((await playedGameWithRelief(user.id)).edition);
    const named = await db.game.findFirstOrThrow({
      where: { familyKey: editions[2]!.familyKey },
      select: { id: true },
    });
    await db.game.update({ where: { id: named.id }, data: { name: `${PREFIX} Lanterne unique` } });
    // Des dates d'obtention distinctes : la plus récente d'abord.
    await db.userEdition.createMany({
      data: editions.map((edition, index) => ({
        userId: user.id,
        editionId: edition.id,
        obtainedAt: new Date(Date.UTC(2026, 0, 1 + index)),
      })),
    });

    const first = await collectionPage(user.id, { limit: 2 });
    expect(first.cards.map((card) => card.editionId)).toEqual([editions[4]!.id, editions[3]!.id]);
    expect(first.next).not.toBeNull();
    const second = await collectionPage(user.id, { limit: 2, cursor: decodeCursor(first.next) });
    expect(second.cards.map((card) => card.editionId)).toEqual([editions[2]!.id, editions[1]!.id]);
    const third = await collectionPage(user.id, { limit: 2, cursor: decodeCursor(second.next) });
    expect(third.cards.map((card) => card.editionId)).toEqual([editions[0]!.id]);
    expect(third.next).toBeNull();

    expect(
      (await collectionPage(user.id, { search: 'lanterne' })).cards.map((card) => card.editionId),
    ).toEqual([editions[2]!.id]);
    expect((await collectionPage(user.id, { kind: 'MYTHIQUE' })).cards).toEqual([]);
    expect((await collectionPage(user.id, { kind: 'RELIEF' })).cards).toHaveLength(5);
    // Une adresse abîmée repart du début au lieu d'échouer.
    expect(decodeCursor('pas-un-curseur')).toBeNull();
  });
});

describe('le catalogue de cartes', () => {
  it('ajoute une variante, puis la retire des boosters sans l’enlever à ses propriétaires', async () => {
    const appId = `${PREFIX}-${Math.random()}`;
    const familyKey = `${PREFIX}-variante-${Math.random()}`;
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: appId,
      name: `${PREFIX} jeu`,
    });
    await db.game.update({ where: { id: game.id }, data: { familyKey, familyLocked: true } });
    const entry = {
      name: 'Jeu',
      steamAppId: appId,
      enabled: true,
      version: 3,
      editions: { RELIEF: 'a', VIVANTE: 'a', MYTHIQUE: 'b' },
      variants: [{ id: 'noel', kind: 'MYTHIQUE' as const, folder: 'b-noel' }],
    };
    await syncCardCatalogue([entry]);
    const noel = await db.gameEdition.findUniqueOrThrow({
      where: { familyKey_kind_variant: { familyKey, kind: 'MYTHIQUE', variant: 'noel' } },
    });
    expect(noel).toMatchObject({ assetPath: '/cartes/b-noel/3/', retired: false });

    await syncCardCatalogue([{ ...entry, variants: [] }]);
    const editions = await db.gameEdition.findMany({
      where: { familyKey },
      orderBy: { variant: 'asc' },
    });
    expect(editions.map((edition) => [edition.variant, edition.retired])).toEqual([
      ['base', false],
      ['base', false],
      ['base', false],
      ['noel', true],
    ]);
    // Remise au catalogue, elle revient dans les boosters.
    await syncCardCatalogue([entry]);
    expect((await db.gameEdition.findUniqueOrThrow({ where: { id: noel.id } })).retired).toBe(
      false,
    );
  });

  it('crée la famille et ses trois éditions, les met à jour, et retire un jeu disparu', async () => {
    const appId = `${PREFIX}-${Math.random()}`;
    const familyKey = `${PREFIX}-famille-${Math.random()}`;
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: appId,
      name: `${PREFIX} jeu`,
    });
    await db.game.update({ where: { id: game.id }, data: { familyKey, familyLocked: true } });
    const entry = {
      name: 'Jeu',
      steamAppId: appId,
      enabled: true,
      version: 1,
      editions: { RELIEF: 'a', VIVANTE: 'a', MYTHIQUE: 'b' },
    };
    // Un jeu que personne n'a importé attend sans erreur.
    expect(await syncCardCatalogue([{ ...entry, steamAppId: `${PREFIX}-absent` }])).toBe(0);

    expect(await syncCardCatalogue([entry])).toBe(1);
    expect(
      await syncCardCatalogue([
        { ...entry, version: 2, editions: { ...entry.editions, MYTHIQUE: 'c' } },
      ]),
    ).toBe(1);
    const family = await db.cardFamily.findUniqueOrThrow({
      where: { familyKey },
      include: { editions: { orderBy: { kind: 'asc' } } },
    });
    expect(family.enabled).toBe(true);
    expect(family.editions.map((edition) => [edition.kind, edition.assetPath])).toEqual([
      // Une retouche publie la version suivante : l'adresse change, le cache ne ment jamais.
      ['RELIEF', '/cartes/a/2/'],
      ['VIVANTE', '/cartes/a/2/'],
      ['MYTHIQUE', '/cartes/c/2/'],
    ]);

    await syncCardCatalogue([]);
    expect((await db.cardFamily.findUniqueOrThrow({ where: { familyKey } })).enabled).toBe(false);
    expect(await db.gameEdition.count({ where: { familyKey } })).toBe(3);
  });
});
