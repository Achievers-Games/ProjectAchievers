import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Prisma, type Platform } from '#prisma';
import { db } from './db';
import { moveGameFamilies, refreshSharedTier } from './card-rarity';
import { resolveIdentity } from './accounts';
import { collectors, listGames, userStats, visibleLibrary } from './queries';
import { saveAchievements, upsertGame } from './sync/store';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();
const family = () => `${PREFIX} rarete ${Math.random()}`;

async function version(
  name: string,
  platform: Platform,
  rarity: number | null,
  console?: string,
  size = 2,
) {
  const game = await upsertGame({
    name,
    platform,
    platformGameId: `${PREFIX}-${Math.random()}`,
    console,
  });
  await saveAchievements(
    game.id,
    Array.from({ length: size }, (_, index) => ({
      platformAchievementId: String(index),
      name: `${name} ${index}`,
      description: '',
      hidden: false,
      trophyType: 'ACHIEVEMENT' as const,
      globalRarity: rarity === null ? null : index === 0 ? rarity : Math.max(rarity, 80),
    })),
  );
  return db.game.findUniqueOrThrow({ where: { id: game.id } });
}

async function tiers(ids: string[]) {
  return (await db.game.findMany({ where: { id: { in: ids } }, select: { tier: true } })).map(
    (game) => game.tier,
  );
}

describe('rareté commune aux plateformes', () => {
  it('moyenne les taux les plus rares, pas les niveaux ni les comptes du joueur', async () => {
    const name = family();
    const steam = await version(name, 'STEAM', 2);
    const psn = await version(name, 'PSN', 4, 'PS5');
    const xbox = await version(name, 'XBOX', 6);
    expect(await tiers([steam.id, psn.id, xbox.id])).toEqual([2, 2, 2]);

    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('Missing player');
    const user = await db.user.update({ where: { id: created.userId }, data: { isPublic: true } });
    for (const game of [steam, psn])
      await db.userGame.create({
        data: {
          userId: user.id,
          gameId: game.id,
          completion: 100,
          totalCount: 2,
          unlockedCount: 2,
        },
      });
    const card = (await visibleLibrary(user.id, false))[0]!;
    expect(card).toMatchObject({ tier: 2, copies: 2 });
    expect(
      (
        await listGames(
          { ownerId: user.id, platform: 'STEAM', tier: 2, sort: 'nom', page: 1 },
          user.id,
        )
      ).games,
    ).toHaveLength(1);
    const stats = await userStats(user.id);
    const ranked = (await collectors(10000)).find((row) => row.handle === user.handle)!;
    expect(stats.tiers).toEqual([0, 1, 0, 0, 0, 0]);
    expect(ranked.tiers).toEqual(stats.tiers);
    expect(ranked.score).toBe(stats.points);
    expect(ranked.cards).toBe(1);
  });

  it('donne le même poids à PlayStation et Steam malgré plusieurs listes PSN', async () => {
    const name = family();
    const steam = await version(name, 'STEAM', 4);
    const ps4 = await version(name, 'PSN', 0.2, 'PS4');
    const ps5 = await version(name, 'PSN', 0.2, 'PS5');
    // (4 + moyenne(0,2 ; 0,2)) / 2 = 2,1 : Or, et non Diamant.
    expect(await tiers([steam.id, ps4.id, ps5.id])).toEqual([3, 3, 3]);
  });

  it('ignore les plateformes sans taux et partage quand même la carte obtenue', async () => {
    const name = family();
    const steam = await version(name, 'STEAM', 0.2);
    const xbox = await version(name, 'XBOX', null);
    expect(await tiers([steam.id, xbox.id])).toEqual([6, 6]);
    const psn = await version(name, 'PSN', 0.4);
    // 0,3 exactement : le seuil Prismatique, sans arrondi en Légendaire.
    expect(await tiers([steam.id, psn.id, xbox.id])).toEqual([5, 5, 5]);
  });

  it('garde un recours commun par nombre de succès si aucun taux n’est exploitable', async () => {
    const name = family();
    const steam = await version(name, 'STEAM', null, undefined, 20);
    const psn = await version(name, 'PSN', null, 'PS5', 40);
    expect(await tiers([steam.id, psn.id])).toEqual([2, 2]);
    await db.achievement.updateMany({
      where: { gameId: { in: [steam.id, psn.id] } },
      data: { globalRarity: 0 },
    });
    await refreshSharedTier(steam.id);
    expect(await tiers([steam.id, psn.id])).toEqual([2, 2]);
  });

  it('recalcule les deux familles après un regroupement, une séparation ou un renommage', async () => {
    const steam = await version(family(), 'STEAM', 0.2);
    const psn = await version(family(), 'PSN', 12);
    await moveGameFamilies([psn.id], { familyKey: steam.familyKey! });
    expect(await tiers([steam.id, psn.id])).toEqual([2, 2]);
    await moveGameFamilies([psn.id], { familyKey: `${psn.id}-seul`, familyLocked: true });
    expect((await db.game.findUniqueOrThrow({ where: { id: steam.id } })).tier).toBe(6);
    expect((await db.game.findUniqueOrThrow({ where: { id: psn.id } })).tier).toBe(1);
    await moveGameFamilies([psn.id], { familyKey: steam.familyKey!, familyLocked: false });
    await upsertGame({ name: family(), platform: 'PSN', platformGameId: psn.platformGameId });
    expect((await db.game.findUniqueOrThrow({ where: { id: steam.id } })).tier).toBe(6);
    expect((await db.game.findUniqueOrThrow({ where: { id: psn.id } })).tier).toBe(1);
  });

  it('la migration recalcule aussi les cartes existantes sans attendre une synchronisation', async () => {
    const name = family();
    const steam = await version(name, 'STEAM', 2);
    const psn = await version(name, 'PSN', 12);
    await db.game.updateMany({ where: { id: { in: [steam.id, psn.id] } }, data: { tier: 6 } });
    const sql = readFileSync(
      'prisma/migrations/20261128000000_shared_card_rarity/migration.sql',
      'utf8',
    );
    await db.$executeRaw(Prisma.raw(sql));
    expect(await tiers([steam.id, psn.id])).toEqual([2, 2]);
  });
});
