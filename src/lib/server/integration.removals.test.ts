// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { refreshStaleSchemas } from './sync/steam';
import { REMOVAL_CONFIRM, saveAchievements, saveProgress, upsertGame } from './sync/store';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();

const achievement = (id: string) => ({
  platformAchievementId: id,
  name: `S${id}`,
  description: '',
  hidden: false,
  trophyType: 'ACHIEVEMENT' as const,
});
const unlock = (id: string) => ({ platformAchievementId: id, unlockedAt: new Date('2026-01-01') });

async function player() {
  return db.user.create({
    data: { handle: `${PREFIX}-${Math.random()}`, displayName: `${PREFIX} joueur` },
  });
}

async function game(ids: string[]) {
  const created = await upsertGame({
    platform: 'STEAM',
    platformGameId: `${PREFIX}-${Math.random()}`,
    name: `${PREFIX} jeu`,
  });
  await saveAchievements(created.id, ids.map(achievement));
  return created;
}

const progressOf = (userId: string, gameId: string) =>
  db.userGame.findUniqueOrThrow({ where: { userId_gameId: { userId, gameId } } });

/** Recule le constat d'un retrait, comme si la première lecture datait d'il y a longtemps. */
const ageRemoval = (userId: string, gameId: string) =>
  db.userGame.update({
    where: { userId_gameId: { userId, gameId } },
    data: { removalSeenAt: new Date(Date.now() - REMOVAL_CONFIRM - 60_000) },
  });

describe('total des joueurs quand la liste d’un jeu change', () => {
  it('recalcule le pourcentage de chaque joueur quand une extension ajoute des succès', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game(['a', 'b']);
    await saveProgress(userId, gameId, [unlock('a'), unlock('b')]);
    expect(await progressOf(userId, gameId)).toMatchObject({ totalCount: 2, completion: 100 });

    await saveAchievements(gameId, ['a', 'b', 'c', 'd'].map(achievement));

    expect(await progressOf(userId, gameId)).toMatchObject({
      unlockedCount: 2,
      totalCount: 4,
      completion: 50,
    });
  });
});

describe('relecture des listes Steam vieillies', () => {
  it('ajoute l’extension d’un vieux jeu sans que son joueur y rejoue', async () => {
    const { id: userId } = await player();
    const appId = String(990_000 + Math.floor(Math.random() * 9_000));
    const created = await upsertGame({
      platform: 'STEAM',
      platformGameId: appId,
      name: `${PREFIX} jeu`,
    });
    await saveAchievements(created.id, ['a', 'b'].map(achievement));
    await saveProgress(userId, created.id, ['a', 'b'].map(unlock));
    await db.game.update({ where: { id: created.id }, data: { schemaSyncedAt: new Date(0) } });

    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input));
      const forUs =
        url.searchParams.get('appid') === appId || url.searchParams.get('gameid') === appId;
      if (url.pathname.includes('GetSchemaForGame')) {
        const achievements = forUs
          ? ['a', 'b', 'c'].map((name) => ({
              name,
              displayName: name,
              hidden: 0,
              icon: '',
              icongray: '',
            }))
          : [];
        return new Response(JSON.stringify({ game: { availableGameStats: { achievements } } }));
      }
      return new Response(JSON.stringify({ achievementpercentages: { achievements: [] } }));
    });

    await refreshStaleSchemas(10_000);

    const progress = await progressOf(userId, created.id);
    expect(progress).toMatchObject({ unlockedCount: 2, totalCount: 3 });
    const refreshed = await db.game.findUniqueOrThrow({ where: { id: created.id } });
    expect(refreshed.schemaSyncedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('succès que la plateforme ne montre plus', () => {
  it('ne retire qu’après une seconde lecture complète, au moins une heure plus tard', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game(['a', 'b', 'c']);
    await saveProgress(userId, gameId, ['a', 'b', 'c'].map(unlock), {}, { complete: true });

    // Première lecture sans « c » : seulement noté.
    const first = await saveProgress(
      userId,
      gameId,
      ['a', 'b'].map(unlock),
      {},
      { complete: true },
    );
    expect(first.removed).toBe(0);
    expect(await progressOf(userId, gameId)).toMatchObject({ unlockedCount: 3 });
    expect((await progressOf(userId, gameId)).removalSeenAt).not.toBeNull();

    // Une relecture rapprochée ne confirme rien.
    await saveProgress(userId, gameId, ['a', 'b'].map(unlock), {}, { complete: true });
    expect(await progressOf(userId, gameId)).toMatchObject({ unlockedCount: 3 });

    await ageRemoval(userId, gameId);
    const confirmed = await saveProgress(
      userId,
      gameId,
      ['a', 'b'].map(unlock),
      {},
      { complete: true },
    );
    expect(confirmed.removed).toBe(1);
    const after = await progressOf(userId, gameId);
    expect(after).toMatchObject({ unlockedCount: 2, removalSeenAt: null });
    expect(after.completion).toBeCloseTo(66.67, 1);
  });

  it('oublie le constat quand le succès réapparaît', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game(['a', 'b']);
    await saveProgress(userId, gameId, ['a', 'b'].map(unlock), {}, { complete: true });
    await saveProgress(userId, gameId, [unlock('a')], {}, { complete: true });
    await ageRemoval(userId, gameId);

    await saveProgress(userId, gameId, ['a', 'b'].map(unlock), {}, { complete: true });
    expect(await progressOf(userId, gameId)).toMatchObject({
      unlockedCount: 2,
      removalSeenAt: null,
    });
  });

  it('ne retire jamais rien sur une liste vide ni sur une lecture partielle', async () => {
    const { id: userId } = await player();
    const { id: gameId } = await game(['a', 'b']);
    await saveProgress(userId, gameId, ['a', 'b'].map(unlock), {}, { complete: true });
    await ageRemoval(userId, gameId);

    await saveProgress(userId, gameId, [], {}, { complete: true });
    await saveProgress(userId, gameId, [unlock('a')]);
    expect(await progressOf(userId, gameId)).toMatchObject({ unlockedCount: 2 });
  });
});
