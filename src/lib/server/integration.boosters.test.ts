// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { BOOSTER_PRICE } from '#lib/boosters';
import { db } from './db';
import { BoosterError, boosterState, openBooster, userCollection } from './boosters';
import { profileCardBanner, resolveCardBanner } from './card-banner';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();
// Les éditions ne dépendent d'aucun jeu : le nettoyage commun ne les voit pas.
afterAll(() => db.gameEdition.deleteMany({ where: { familyKey: { startsWith: PREFIX } } }));

async function player(shards = 0) {
  return db.user.create({
    data: { handle: `${PREFIX}-${Math.random()}`, displayName: `${PREFIX} joueur`, shards },
  });
}

/** Un jeu joué par le joueur, avec une édition Relief. */
async function playedGameWithRelief(userId: string, options: { adultOnly?: boolean } = {}) {
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
  const edition = await db.gameEdition.create({
    data: { familyKey, kind: 'RELIEF', assetPath: `/cartes/${familyKey}/1` },
  });
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

  it('ne s’ouvre pas sans édition possible, et écarte les jeux réservés aux adultes', async () => {
    const user = await player(100);
    await playedGameWithRelief(user.id, { adultOnly: true });

    expect((await boosterState(user.id)).canDraw).toBe(false);
    await expect(openBooster(user.id, 'SHARDS')).rejects.toMatchObject({ code: 'no_cards' });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).shards).toBe(100);
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
    expect(await profileCardBanner(user.id)).toMatchObject({
      kind: 'RELIEF',
      game: { slug: game.slug },
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

    const before = await userCollection(user.id);
    expect(before.cards).toEqual([]);
    expect(before.missing).toEqual({ RELIEF: 1, VIVANTE: 0, MYTHIQUE: 0 });

    await openBooster(user.id, 'DAILY');
    const after = await userCollection(user.id);
    // Les doublons du même booster ne créent pas de seconde carte.
    expect(after.cards).toHaveLength(1);
    expect(after.cards[0]).toMatchObject({
      editionId: edition.id,
      kind: 'RELIEF',
      game: { slug: game.slug },
    });
    expect(after.missing.RELIEF).toBe(0);
  });
});
