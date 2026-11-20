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

it('traite le déblocage intégral d’Unturned comme les autres outils de déblocage', async () => {
  const user = await player();
  const moderator = await player('MODERATOR');
  const steamId = user.accounts[0]!.providerUserId;
  const allowed = await game(true);
  const unturned = await game(false, '304930');
  const at = Math.floor(Date.now() / 1000) * 1000;
  await saveProgress(user.id, allowed, full(at), {}, { steamId, complete: true });
  await saveProgress(user.id, unturned, full(at), {}, { steamId, complete: true });
  expect(await progress(user.id, allowed)).toMatchObject({ completion: 100 });
  // Plus de revue manuelle à part : un lot ordinaire, hors score en attendant la modération.
  const review = await db.steamIntegrityReview.findFirstOrThrow({
    where: { steamId, gameId: unturned },
  });
  expect(review).toMatchObject({ status: 'PENDING', suspendedAt: null });
  expect(await progress(user.id, unturned)).toMatchObject({ unlockedCount: 1 });

  await resolveSteamReview(review.id, review.openedAt, moderator.id, [], 'suspend', false);
  expect(await progress(user.id, unturned)).toMatchObject({ unlockedCount: 0, completion: 0 });
  expect(await progress(user.id, allowed)).toMatchObject({ completion: 100 });
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

it('valide d’office un lot joué pour de vrai, sans alerte ni revue', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000;
  // 70 h de jeu pour 21 succès : une sauvegarde relue, pas un outil de déblocage.
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 4200 },
    { steamId, complete: true },
  );
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 21, completion: 100 });
  const review = await db.steamIntegrityReview.findUniqueOrThrow({
    where: { steamId_gameId: { steamId, gameId } },
  });
  expect(review).toMatchObject({ status: 'APPROVED', flagged: [], reviewedBy: null });
  expect(review.approved).toHaveLength(20);
  expect(review.trust).toMatchObject({ verdict: 'trusted' });
  expect(await db.steamIntegrityReview.count({ where: { steamId, status: 'PENDING' } })).toBe(0);
  expect((await notifications(user.id)).filter((item) => item.kind === 'integrity')).toHaveLength(
    0,
  );
  // Une relecture ne rouvre rien.
  await saveProgress(user.id, gameId, full(at), {}, { steamId, complete: true });
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 21 });
});

it('suspend d’emblée une liste complète obtenue en quelques minutes', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000;
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 8 },
    { steamId, complete: true },
  );
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 0, completion: 0 });
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId } },
    }),
  ).toMatchObject({
    status: 'PENDING',
    suspendedAt: expect.any(Date),
    trust: { verdict: 'cheat' },
  });
});

it('libère une revue en attente quand le temps de jeu arrive, sauf pour les jeux en revue manuelle', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const manual = await game(false, '359550');
  const at = Math.floor(Date.now() / 1000) * 1000;
  for (const id of [gameId, manual]) {
    await saveProgress(user.id, id, full(at), {}, { steamId, complete: true });
    expect(await progress(user.id, id)).toMatchObject({ unlockedCount: 1 });
  }
  await db.userGame.updateMany({ where: { userId: user.id }, data: { playtimeMinutes: 4200 } });
  for (const id of [gameId, manual]) {
    await saveProgress(user.id, id, full(at), {}, { steamId, complete: true });
  }
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 21 });
  expect((await notifications(user.id)).filter((item) => item.kind === 'integrity')).toEqual(
    expect.arrayContaining([expect.objectContaining({ href: expect.stringContaining('?succes') })]),
  );
  expect(await progress(user.id, manual)).toMatchObject({ unlockedCount: 1 });
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId: manual } },
    }),
  ).toMatchObject({ status: 'PENDING', trust: { verdict: 'trusted' } });
});

it('débloque un jeu remis à zéro sur Steam, puis compte la nouvelle partie', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000;
  const read = { steamId, complete: true };
  await saveProgress(user.id, gameId, full(at), { playtimeMinutes: 8 }, read);
  const scope = { steamId_gameId: { steamId, gameId } };
  expect(await db.steamIntegrityReview.findUniqueOrThrow({ where: scope })).toMatchObject({
    suspendedAt: expect.any(Date),
  });

  // Une seule lecture vide peut venir d'un raté de Steam : le blocage tient.
  await saveProgress(user.id, gameId, [], {}, read);
  const once = await db.steamIntegrityReview.findUniqueOrThrow({ where: scope });
  expect(once).toMatchObject({ suspendedAt: expect.any(Date), emptySeenAt: expect.any(Date) });
  // Une lecture partielle (suivi en direct) ne compte pas comme une remise à zéro.
  await db.steamIntegrityReview.update({
    where: scope,
    data: { emptySeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  });
  await saveProgress(user.id, gameId, [], {}, { steamId });
  expect(await db.steamIntegrityReview.findUniqueOrThrow({ where: scope })).toMatchObject({
    suspendedAt: expect.any(Date),
  });

  await saveProgress(user.id, gameId, [], {}, read);
  expect(await db.steamIntegrityReview.findUniqueOrThrow({ where: scope })).toMatchObject({
    status: 'APPROVED',
    suspendedAt: null,
    rejected: [],
    resetAt: expect.any(Date),
  });
  expect((await notifications(user.id)).filter((item) => item.kind === 'integrity')).toEqual([
    expect.objectContaining({ title: expect.stringContaining('débloqué') }),
  ]);

  const replay = [0, 1, 2].map((i) => ({
    platformAchievementId: `a${i}`,
    unlockedAt: new Date(at + 3_600_000 * (i + 1)),
  }));
  await saveProgress(user.id, gameId, replay, { playtimeMinutes: 200 }, read);
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 3 });
});

it('lève le blocage dès que la nouvelle partie remplace les anciens succès, sans laisser retricher', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000 - 86_400_000;
  const read = { steamId, complete: true };
  const scope = { steamId_gameId: { steamId, gameId } };
  await saveProgress(user.id, gameId, full(at), { playtimeMinutes: 8 }, read);
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 0 });

  // Remis à zéro puis rejoué avant le passage du site : aucune lecture vide, mais plus aucun
  // déblocage d'avant le blocage. Un seul ancien succès encore là, et le blocage tient.
  const after = Date.now() + 1000;
  const replay = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      platformAchievementId: `a${i}`,
      unlockedAt: new Date(after + 60_000 * i),
    }));
  await saveProgress(user.id, gameId, [...replay(2), full(at)[0]!], { playtimeMinutes: 300 }, read);
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 0 });
  await saveProgress(user.id, gameId, replay(3), { playtimeMinutes: 300 }, read);
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 3 });
  expect(await db.steamIntegrityReview.findUniqueOrThrow({ where: scope })).toMatchObject({
    status: 'APPROVED',
    suspendedAt: null,
    resetAt: expect.any(Date),
  });

  // Remettre à zéro pour retricher aussitôt : le nouveau lot est jugé comme le premier.
  const second = await game();
  await saveProgress(user.id, second, full(at), { playtimeMinutes: 8 }, read);
  const cheat = Array.from({ length: 21 }, (_, i) => ({
    platformAchievementId: `a${i}`,
    unlockedAt: new Date(after),
  }));
  await saveProgress(user.id, second, cheat, { playtimeMinutes: 9 }, read);
  expect(await progress(user.id, second)).toMatchObject({ unlockedCount: 0 });
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId: second } },
    }),
  ).toMatchObject({ suspendedAt: expect.any(Date), resetAt: expect.any(Date) });
});
