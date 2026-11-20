import 'dotenv/config';
import { expect, it, vi } from 'vitest';
import { db } from './db';
import { notifications, unseenNotices } from './notifications';
import { excludedSteamUnlocks } from './steam-integrity';
import { auditSteamHistory } from './sync/live';
import {
  resolveSteamReview,
  REMOVAL_CONFIRM,
  saveAchievements,
  saveProgress,
  upsertGame,
} from './sync/store';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();

async function player(
  role: 'USER' | 'MODERATOR' = 'USER',
  steamId = `${PREFIX}-${crypto.randomUUID()}`,
) {
  return db.user.create({
    data: {
      handle: `${PREFIX}-${crypto.randomUUID()}`,
      displayName: PREFIX,
      role,
      accounts: { create: { provider: 'STEAM', providerUserId: steamId, displayName: PREFIX } },
    },
    include: { accounts: true },
  });
}

async function game(allowBatches = false, appId = `${PREFIX}-${crypto.randomUUID()}`) {
  const created = await upsertGame({
    platform: 'STEAM',
    platformGameId: appId,
    name: `${PREFIX} jeu`,
  });
  await saveAchievements(
    created.id,
    Array.from({ length: 21 }, (_, i) => ({
      platformAchievementId: `a${i}`,
      name: `Succès ${i}`,
      description: '',
      hidden: false,
      trophyType: 'ACHIEVEMENT' as const,
    })),
  );
  if (allowBatches)
    await db.game.update({ where: { id: created.id }, data: { allowSteamBatches: true } });
  return created.id;
}

const full = (at: number) =>
  Array.from({ length: 21 }, (_, i) => ({
    platformAchievementId: `a${i}`,
    unlockedAt: new Date(i === 20 ? at - 86_400_000 : at),
  }));

const progress = (userId: string, gameId: string) =>
  db.userGame.findUniqueOrThrow({
    where: { userId_gameId: { userId, gameId } },
  });

it('isole un lot ambigu, puis suspend les deux jeux après corroboration et rétablit les succès approuvés', async () => {
  const user = await player();
  const moderator = await player('MODERATOR');
  const steamId = user.accounts[0]!.providerUserId;
  const first = await game();
  const second = await game();
  const at = Math.floor(Date.now() / 1000) * 1000;
  const old = full(at).slice(-1);
  await saveProgress(user.id, first, old, {}, { steamId, complete: true });
  await saveProgress(user.id, first, full(at), {}, { steamId, complete: true });
  expect(await progress(user.id, first)).toMatchObject({
    unlockedCount: 1,
    reportedUnlockedCount: 21,
  });
  expect(await unseenNotices(moderator.id)).toBe(1);
  expect((await notifications(user.id)).filter((item) => item.kind === 'integrity')).toHaveLength(
    1,
  );

  await saveProgress(user.id, second, full(at + 1000), {}, { steamId, complete: true });
  for (const gameId of [first, second]) {
    expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 0, completion: 0 });
  }
  expect((await notifications(user.id)).filter((item) => item.kind === 'integrity')).toHaveLength(
    2,
  );

  const review = await db.steamIntegrityReview.findUniqueOrThrow({
    where: { steamId_gameId: { steamId, gameId: first } },
  });
  expect(
    await resolveSteamReview(review.id, review.openedAt, moderator.id, [], 'approve', false),
  ).toBe(true);
  expect(await progress(user.id, first)).toMatchObject({ unlockedCount: 21, completion: 100 });
  expect(await progress(user.id, second)).toMatchObject({ unlockedCount: 0, completion: 0 });
  await saveProgress(user.id, first, full(at), {}, { steamId, complete: true });
  expect(await progress(user.id, first)).toMatchObject({ completion: 100 });

  const tail = await db.steamIntegrityReview.findUniqueOrThrow({
    where: { steamId_gameId: { steamId, gameId: second } },
  });
  await resolveSteamReview(
    tail.id,
    tail.openedAt,
    moderator.id,
    [tail.flagged[0]!],
    'selected',
    false,
  );
  expect(await progress(user.id, second)).toMatchObject({ unlockedCount: 2, totalCount: 21 });
  await saveProgress(user.id, second, full(at + 1000), {}, { steamId, complete: true });
  expect(await progress(user.id, second)).toMatchObject({ unlockedCount: 2 });
});

it('réexamine les succès historiques, les garde visibles hors score et n’envoie qu’une alerte', async () => {
  const user = await player();
  const moderator = await player('MODERATOR');
  const gameId = await game(false, '999946');
  const legitimateGame = await game(true, '999947');
  const imported = full(Date.UTC(2023, 10, 14, 15, 51, 54));
  await saveProgress(user.id, gameId, imported);
  await saveProgress(user.id, legitimateGame, imported);
  expect(await progress(user.id, gameId)).toMatchObject({
    completion: 100,
    reportedUnlockedCount: null,
  });

  const fetch = vi.fn(async () =>
    Response.json({
      playerstats: {
        achievements: imported.map((unlock) => ({
          apiname: unlock.platformAchievementId,
          achieved: 1,
          unlocktime: unlock.unlockedAt.getTime() / 1000,
        })),
      },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await auditSteamHistory(24, user.id);
  await auditSteamHistory(24, user.id);
  expect(fetch).toHaveBeenCalledTimes(1);
  const review = await db.steamIntegrityReview.findFirstOrThrow({
    where: { gameId, userId: user.id },
  });
  expect(review).toMatchObject({ status: 'PENDING', suspendedAt: null });
  expect(excludedSteamUnlocks(review).size).toBe(20);
  expect(await progress(user.id, gameId)).toMatchObject({
    unlockedCount: 1,
    reportedUnlockedCount: 21,
  });
  expect(await progress(user.id, legitimateGame)).toMatchObject({ completion: 100 });
  expect(await unseenNotices(moderator.id)).toBe(1);
  expect((await notifications(user.id)).filter((item) => item.kind === 'integrity')).toEqual([
    expect.objectContaining({ href: expect.stringContaining('?succes=hors-score') }),
  ]);
  await resolveSteamReview(review.id, review.openedAt, moderator.id, [], 'approve', false);
  expect(await progress(user.id, gameId)).toMatchObject({ completion: 100, unlockedCount: 21 });
  const resolved = await db.steamIntegrityReview.findUniqueOrThrow({ where: { id: review.id } });
  expect(excludedSteamUnlocks(resolved).size).toBe(0);
});

it('conserve les lots légitimes déclarés et ne transforme pas Unturned en preuve de corroboration', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const allowed = await game(true);
  const ordinary = await game();
  const manual = await game(false, '304930');
  const at = Math.floor(Date.now() / 1000) * 1000;
  for (const gameId of [allowed, ordinary, manual]) {
    await saveProgress(user.id, gameId, full(at), {}, { steamId, complete: true });
  }
  expect(await progress(user.id, allowed)).toMatchObject({ completion: 100 });
  expect(
    await db.steamIntegrityReview.count({ where: { steamId, suspendedAt: { not: null } } }),
  ).toBe(0);
  expect(await db.steamIntegrityReview.count({ where: { steamId, status: 'PENDING' } })).toBe(2);
});

it('garde une exclusion confirmée après suppression et accepte une remise à zéro Steam confirmée', async () => {
  const user = await player();
  const moderator = await player('MODERATOR');
  const steamId = user.accounts[0]!.providerUserId;
  const suspended = await game();
  const at = Math.floor(Date.now() / 1000) * 1000;
  const read = { steamId, complete: true };
  await saveProgress(user.id, suspended, full(at), {}, read);
  const review = await db.steamIntegrityReview.findFirstOrThrow({
    where: { steamId, gameId: suspended },
  });
  await resolveSteamReview(review.id, review.openedAt, moderator.id, [], 'suspend', false);
  await db.user.delete({ where: { id: user.id } });
  const rejoined = await player('USER', steamId);
  await saveProgress(rejoined.id, suspended, full(at), {}, read);
  expect(await progress(rejoined.id, suspended)).toMatchObject({ completion: 0, unlockedCount: 0 });

  const reset = await game(true);
  await saveProgress(rejoined.id, reset, full(at), {}, read);
  await saveProgress(rejoined.id, reset, [], {}, read);
  expect(await progress(rejoined.id, reset)).toMatchObject({ completion: 100 });
  await db.userGame.update({
    where: { userId_gameId: { userId: rejoined.id, gameId: reset } },
    data: { removalSeenAt: new Date(Date.now() - REMOVAL_CONFIRM - 1000) },
  });
  await saveProgress(rejoined.id, reset, [], {}, read);
  expect(await progress(rejoined.id, reset)).toMatchObject({ completion: 0, unlockedCount: 0 });
});
