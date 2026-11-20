// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { GAME_SHARD_CAP, STARTER_CAP } from '#lib/shards';
import { db } from './db';
import { grantMissingStarters, grantStarter } from './shards';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-06-01T00:00:00Z');
const after = new Date(start.getTime() + DAY);
const before = new Date(start.getTime() - DAY);

async function player(shardsFrom = start) {
  return db.user.create({
    data: { handle: `${PREFIX}-${Math.random()}`, displayName: `${PREFIX} joueur`, shardsFrom },
  });
}

/** Un jeu dont chaque succès a la rareté donnée, en % de joueurs. */
async function game(rarities: number[], tier?: number) {
  const created = await upsertGame({
    platform: 'STEAM',
    platformGameId: `${PREFIX}-${Math.random()}`,
    name: `${PREFIX} jeu`,
  });
  await saveAchievements(
    created.id,
    rarities.map((globalRarity, index) => ({
      platformAchievementId: `a${index}`,
      name: `S${index}`,
      description: '',
      hidden: false,
      trophyType: 'ACHIEVEMENT' as const,
      globalRarity,
    })),
  );
  if (tier) await db.game.update({ where: { id: created.id }, data: { tier } });
  return created;
}

const unlocks = (indexes: number[], unlockedAt: Date) =>
  indexes.map((index) => ({ platformAchievementId: `a${index}`, unlockedAt }));

const balance = async (userId: string) =>
  (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { shards: true } })).shards;

const ledger = async (userId: string) =>
  (await db.shardEntry.aggregate({ where: { userId }, _sum: { delta: true } }))._sum.delta ?? 0;

describe('éclats gagnés à la synchro', () => {
  it('crédite chaque nouveau succès selon sa rareté, une seule fois', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game([80, 30, 0.5, 60]);

    await saveProgress(userId, gameId, unlocks([0, 1, 2], after));
    expect(await balance(userId)).toBe(1 + 2 + 30);

    // Une synchro rejouée, avec les mêmes succès, ne paie rien de plus.
    await saveProgress(userId, gameId, unlocks([0, 1, 2], after));
    expect(await balance(userId)).toBe(33);
    expect(await ledger(userId)).toBe(33);
  });

  it('ne verse rien tant que le temps de jeu Steam est privé, capital compris', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game([80, 30, 0.5, 60]);
    const account = await db.linkedAccount.create({
      data: {
        userId,
        provider: 'STEAM',
        providerUserId: `${PREFIX}-${Math.random()}`,
        displayName: PREFIX,
        playtimeHidden: true,
      },
    });
    await saveProgress(userId, gameId, unlocks([0], before));
    await saveProgress(userId, gameId, unlocks([1, 2], after));
    expect(await grantStarter(userId)).toBe(0);
    expect(await balance(userId)).toBe(0);

    // Rendu public : le capital de départ arrive, les succès gagnés en privé restent sans éclats.
    await db.linkedAccount.update({ where: { id: account.id }, data: { playtimeHidden: false } });
    expect(await grantStarter(userId)).toBeGreaterThan(0);
    await saveProgress(userId, gameId, unlocks([0, 1, 2], after));
    expect(await ledger(userId)).toBe(await balance(userId));
    expect(await db.shardEntry.count({ where: { userId, reason: 'ACHIEVEMENT' } })).toBe(0);
  });

  it('laisse l’historique d’avant le départ au capital de départ', async () => {
    const { id: userId } = await player();
    // Un troisième succès reste verrouillé : le jeu n'est pas fini, donc pas de bonus ici.
    const { id: gameId } = await game([0.5, 0.5, 90]);

    await saveProgress(userId, gameId, unlocks([0], before));
    expect(await balance(userId)).toBe(0);
    await saveProgress(userId, gameId, unlocks([0, 1], after));
    expect(await balance(userId)).toBe(30);
  });

  it('plafonne les succès d’un même jeu', async () => {
    const { id: userId } = await player();
    const rare = Array.from({ length: 20 }, () => 0.5);
    const { id: gameId } = await game([...rare, 90]);

    await saveProgress(userId, gameId, unlocks([...rare.keys()], after));
    expect(await balance(userId)).toBe(GAME_SHARD_CAP);
  });

  it('paie le bonus d’un jeu fini une seule fois, même si le 100 % se perd puis revient', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game([80, 80], 4);

    await saveProgress(userId, gameId, unlocks([0, 1], after));
    expect(await balance(userId)).toBe(1 + 1 + 110);

    // Une extension ajoute un succès : le jeu n'est plus fini, puis l'est de nouveau.
    await saveAchievements(gameId, [
      ...[0, 1].map((index) => ({
        platformAchievementId: `a${index}`,
        name: `S${index}`,
        description: '',
        hidden: false,
        trophyType: 'ACHIEVEMENT' as const,
        globalRarity: 80,
      })),
      {
        platformAchievementId: 'a2',
        name: 'S2',
        description: '',
        hidden: false,
        trophyType: 'ACHIEVEMENT' as const,
        globalRarity: 80,
      },
    ]);
    await saveProgress(userId, gameId, unlocks([0, 1, 2], after));
    expect(await balance(userId)).toBe(113);
  });

  it('ne paie pas le bonus d’un jeu fini avant le départ', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game([80], 6);

    await saveProgress(userId, gameId, unlocks([0], before));
    expect(await balance(userId)).toBe(0);
  });
});

describe('capital de départ', () => {
  it('vaut l’historique au barème, et un appel rejoué ne paie rien', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game([0.5, 30], 2);
    await saveProgress(userId, gameId, unlocks([0, 1], before));

    expect(await grantStarter(userId)).toBe(30 + 2 + 40);
    expect(await grantStarter(userId)).toBe(0);
    expect(await balance(userId)).toBe(72);
  });

  it('se complète avec un compte lié plus tard, sans dépasser le plafond', async () => {
    const { id: userId } = await player();
    const rare = Array.from({ length: 14 }, () => 0.5);
    const first = await game(rare);
    await saveProgress(userId, first.id, unlocks([...rare.keys()], before));
    expect(await grantStarter(userId)).toBe(14 * 30);

    for (let i = 0; i < 2; i++) {
      const more = await game(rare);
      await saveProgress(userId, more.id, unlocks([...rare.keys()], before));
    }
    expect(await grantStarter(userId)).toBe(STARTER_CAP - 14 * 30);
    expect(await balance(userId)).toBe(STARTER_CAP);
    expect(await ledger(userId)).toBe(STARTER_CAP);
  });

  it('est versé par l’entretien aux joueurs inscrits avant les éclats', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game([30]);
    await saveProgress(userId, gameId, unlocks([0], before));

    // D'autres joueurs peuvent attendre dans la base de test : on traite jusqu'au nôtre.
    while ((await balance(userId)) === 0 && (await grantMissingStarters(50)) > 0);
    expect(await balance(userId)).toBe(2 + 20);
    const served = await db.shardEntry.count({ where: { userId, reason: 'STARTER' } });
    expect(served).toBe(1);
  });
});
