import 'dotenv/config';
import { expect, it, vi } from 'vitest';
import { db } from './db';
import { notifications, unseenNotices } from './notifications';
import { excludedSteamUnlocks } from './steam-integrity';
import { addSteamProof } from './steam-proof';
import { auditSteamHistory, recheckBlockedSteam } from './sync/live';
import { fetchUnlockList } from './sync/steam';
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
  // 70 h de jeu dont 10 h hors ligne pour 21 succès : une sauvegarde relue, pas un outil.
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 4200, offlinePlaytimeMinutes: 600 },
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

it('libère une revue en attente quand le temps de jeu arrive', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000;
  await saveProgress(user.id, gameId, full(at), {}, { steamId, complete: true });
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 1 });
  // Le temps seul ne suffit plus : il faut un second signal, ici du jeu hors ligne.
  await db.userGame.updateMany({ where: { userId: user.id }, data: { playtimeMinutes: 4200 } });
  await saveProgress(user.id, gameId, full(at), {}, { steamId, complete: true });
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 1 });
  await db.userGame.updateMany({
    where: { userId: user.id },
    data: { playtimeMinutes: 4800, offlinePlaytimeMinutes: 600 },
  });
  await saveProgress(user.id, gameId, full(at), {}, { steamId, complete: true });
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 21 });
  expect((await notifications(user.id)).filter((item) => item.kind === 'integrity')).toEqual(
    expect.arrayContaining([expect.objectContaining({ href: expect.stringContaining('?succes') })]),
  );
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
    unlockedAt: new Date(Date.now() + 1000 + 60_000 * i),
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

it('compte le temps hors ligne et libère un lot légitime à la relecture des jeux bloqués', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const appId = String(900_000 + Math.floor(Math.random() * 99_999));
  const gameId = await game(false, appId);
  const at = Math.floor(Date.now() / 1000) * 1000 - 86_400_000;
  // Lies of P : 3 h connecté au compteur de Steam, le reste joué hors ligne.
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 180 },
    { steamId, complete: true },
  );
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 1 });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('GetOwnedGames')) {
        return Response.json({
          response: {
            game_count: 1,
            games: [{ appid: Number(appId), playtime_forever: 180, playtime_disconnected: 462 }],
          },
        });
      }
      return Response.json({
        playerstats: {
          success: true,
          achievements: full(at).map((unlock) => ({
            apiname: unlock.platformAchievementId,
            achieved: 1,
            unlocktime: unlock.unlockedAt.getTime() / 1000,
          })),
        },
      });
    }),
  );
  await recheckBlockedSteam([user.id]);
  vi.unstubAllGlobals();
  expect(await progress(user.id, gameId)).toMatchObject({
    unlockedCount: 21,
    playtimeMinutes: 642,
    offlinePlaytimeMinutes: 462,
  });
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId } },
    }),
  ).toMatchObject({ status: 'APPROVED', trust: { verdict: 'trusted' } });
});

it('lève le blocage d’un coup quand Steam liste tous les succès à zéro', async () => {
  const user = await player();
  const moderator = await player('MODERATOR');
  const steamId = user.accounts[0]!.providerUserId;
  const auto = await game();
  const confirmed = await game();
  const at = Math.floor(Date.now() / 1000) * 1000 - 86_400_000;
  const read = { steamId, complete: true };
  await saveProgress(user.id, auto, full(at), { playtimeMinutes: 8 }, read);
  await saveProgress(user.id, confirmed, full(at), {}, read);
  const review = await db.steamIntegrityReview.findUniqueOrThrow({
    where: { steamId_gameId: { steamId, gameId: confirmed } },
  });
  await resolveSteamReview(review.id, review.openedAt, moderator.id, [], 'suspend', false);

  // Une suspension confirmée par la modération ne tombe pas sur un bon score.
  await saveProgress(user.id, confirmed, full(at), { playtimeMinutes: 4200 }, read);
  expect(await progress(user.id, confirmed)).toMatchObject({ unlockedCount: 0 });

  await saveProgress(user.id, auto, [], {}, { ...read, cleared: true });
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId: auto } },
    }),
  ).toMatchObject({ status: 'APPROVED', suspendedAt: null, resetAt: expect.any(Date) });
});

it('ne rachète pas un lot en laissant tourner le jeu après coup', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000 - 86_400_000;
  const read = { steamId, complete: true };
  // 30 min connecté au moment du lot : en attente, et ce temps est figé.
  await saveProgress(user.id, gameId, full(at), { playtimeMinutes: 30 }, read);
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId } },
    }),
  ).toMatchObject({ status: 'PENDING', flaggedPlaytime: 30 });
  // 70 h connecté ensuite : ne compte pas. Du temps hors ligne, si.
  await saveProgress(user.id, gameId, full(at), { playtimeMinutes: 4200 }, read);
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 1 });
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 4200 + 600, offlinePlaytimeMinutes: 600 },
    read,
  );
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 21 });
});

it('ne suspend pas un jeu à progression partagée, et compte le même jeu sur une autre plateforme', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const read = { steamId, complete: true };
  const at = Math.floor(Date.now() / 1000) * 1000 - 86_400_000;
  // Overwatch : 300 h sur Battle.net, 20 min sur Steam.
  const imported = await game();
  await db.game.update({ where: { id: imported }, data: { crossProgress: true } });
  await saveProgress(user.id, imported, full(at), { playtimeMinutes: 8 }, read);
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId: imported } },
    }),
  ).toMatchObject({ status: 'PENDING', suspendedAt: null, trust: { verdict: 'review' } });

  // Le même jeu, joué sur un compte Xbox lié : vérifié par le site, le lot passe.
  const family = `${PREFIX}-famille-${crypto.randomUUID()}`;
  const steamGame = await game();
  const xbox = await upsertGame({
    platform: 'XBOX',
    platformGameId: `${PREFIX}-${crypto.randomUUID()}`,
    name: `${PREFIX} jeu xbox`,
  });
  await db.game.updateMany({
    where: { id: { in: [steamGame, xbox.id] } },
    data: { familyKey: family },
  });
  await db.userGame.create({
    data: { userId: user.id, gameId: xbox.id, completion: 80, unlockedCount: 40, totalCount: 50 },
  });
  await saveProgress(user.id, steamGame, full(at), { playtimeMinutes: 8 }, read);
  expect(await progress(user.id, steamGame)).toMatchObject({ unlockedCount: 21 });
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId: steamGame } },
    }),
  ).toMatchObject({ status: 'APPROVED', trust: { verdict: 'trusted' } });
});

it('joint les preuves du joueur à sa revue en attente, trois au plus', async () => {
  const user = await player();
  const moderator = await player('MODERATOR');
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000 - 86_400_000;
  expect(await addSteamProof(user.id, gameId, '300 h ailleurs', null)).toEqual({
    ok: false,
    reason: 'proof_closed',
  });
  await saveProgress(user.id, gameId, full(at), {}, { steamId, complete: true });
  await db.user.update({ where: { id: moderator.id }, data: { notificationsSeenAt: new Date() } });

  const png = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])],
    'preuve.png',
    { type: 'image/png' },
  );
  const fake = new File([new Uint8Array([1, 2, 3, 4])], 'preuve.png', { type: 'image/png' });
  expect(await addSteamProof(user.id, gameId, '', fake)).toEqual({
    ok: false,
    reason: 'proof_invalid',
  });
  for (const message of ['un', 'deux', 'trois', 'quatre']) {
    expect(await addSteamProof(user.id, gameId, message, png)).toEqual({ ok: true });
  }
  const review = await db.steamIntegrityReview.findUniqueOrThrow({
    where: { steamId_gameId: { steamId, gameId } },
    include: { proofs: { orderBy: { createdAt: 'asc' } } },
  });
  expect(review.proofAt).toEqual(expect.any(Date));
  expect(review.proofs.map((proof) => proof.message)).toEqual(['deux', 'trois', 'quatre']);
  expect(review.proofs[0]).toMatchObject({ imageType: 'image/png' });
  expect(
    (await notifications(moderator.id)).some(
      (item) => item.kind === 'integrity' && item.unread && item.href.includes(review.id),
    ),
  ).toBe(true);
});

it('repère une progression trop rapide sans lot, d’après le temps complétionniste de Lure', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const appId = `${PREFIX}-${crypto.randomUUID()}`;
  const gameId = await game(false, appId);
  await db.game.update({ where: { id: gameId }, data: { totalAchievements: 21 } });
  // 100 % en 40 h d'ordinaire : 21 succès espacés d'une heure, en 3 h de jeu.
  await db.lureGame.create({
    data: { steamAppId: appId, found: true, completionistMinutes: 2400, fetchedAt: new Date() },
  });
  const at = Math.floor(Date.now() / 1000) * 1000 - 30 * 86_400_000;
  const spread = Array.from({ length: 21 }, (_, i) => ({
    platformAchievementId: `a${i}`,
    unlockedAt: new Date(at + i * 3_600_000),
  }));
  await saveProgress(
    user.id,
    gameId,
    spread,
    { playtimeMinutes: 180 },
    { steamId, complete: true },
  );
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 0 });
  expect(
    await db.steamIntegrityReview.findUniqueOrThrow({
      where: { steamId_gameId: { steamId, gameId } },
    }),
  ).toMatchObject({ trust: { verdict: 'cheat' } });

  // Le même rythme avec 30 h de jeu : rien à signaler.
  const other = await player();
  const otherSteam = other.accounts[0]!.providerUserId;
  await saveProgress(
    other.id,
    gameId,
    spread,
    { playtimeMinutes: 1800 },
    {
      steamId: otherSteam,
      complete: true,
    },
  );
  expect(await progress(other.id, gameId)).toMatchObject({ unlockedCount: 21 });
});

it('lève la suspension automatique d’un jeu marqué ensuite comme progression partagée', async () => {
  const user = await player();
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000;
  const scope = { steamId_gameId: { steamId, gameId } };
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 8 },
    { steamId, complete: true },
  );
  expect(await db.steamIntegrityReview.findUniqueOrThrow({ where: scope })).toMatchObject({
    suspendedAt: expect.any(Date),
  });

  await db.game.update({ where: { id: gameId }, data: { crossProgress: true } });
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 8 },
    { steamId, complete: true },
  );
  // Plus bloqué, mais le lot attend toujours la modération, hors score.
  expect(await db.steamIntegrityReview.findUniqueOrThrow({ where: scope })).toMatchObject({
    status: 'PENDING',
    suspendedAt: null,
  });
  // Le rythme avait signalé les 21 succès au premier examen : ils attendent tous la modération.
  expect(await progress(user.id, gameId)).toMatchObject({ unlockedCount: 0 });
});

it('garde la suspension d’un modérateur même sur un jeu à progression partagée', async () => {
  const user = await player();
  const moderator = await player('MODERATOR');
  const steamId = user.accounts[0]!.providerUserId;
  const gameId = await game();
  const at = Math.floor(Date.now() / 1000) * 1000;
  const scope = { steamId_gameId: { steamId, gameId } };
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 8 },
    { steamId, complete: true },
  );
  const review = await db.steamIntegrityReview.findUniqueOrThrow({ where: scope });
  await resolveSteamReview(review.id, review.openedAt, moderator.id, [], 'suspend', false);

  await db.game.update({ where: { id: gameId }, data: { crossProgress: true } });
  await saveProgress(
    user.id,
    gameId,
    full(at),
    { playtimeMinutes: 8 },
    { steamId, complete: true },
  );
  expect(await db.steamIntegrityReview.findUniqueOrThrow({ where: scope })).toMatchObject({
    suspendedAt: expect.any(Date),
  });
});

it('fait tourner la relecture de fond des jeux bloqués au lieu de relire toujours les mêmes', async () => {
  for (let i = 0; i < 2; i++) {
    const user = await player();
    const steamId = user.accounts[0]!.providerUserId;
    const gameId = await game(false, String(800_000 + Math.floor(Math.random() * 99_999)));
    const at = Math.floor(Date.now() / 1000) * 1000;
    await saveProgress(
      user.id,
      gameId,
      full(at),
      { playtimeMinutes: 8 },
      { steamId, complete: true },
    );
  }
  const read: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes('GetPlayerAchievements')) {
        read.push(`${url.searchParams.get('steamid')}:${url.searchParams.get('appid')}`);
      }
      return Response.json({ response: { game_count: 0 }, playerstats: { success: false } });
    }),
  );
  await recheckBlockedSteam(undefined, 1);
  await recheckBlockedSteam(undefined, 1);
  vi.unstubAllGlobals();
  expect(read).toHaveLength(2);
  expect(read[0]).not.toBe(read[1]);
});

it('fait passer derrière les autres un jeu du contrôle de rythme devenu illisible', async () => {
  const user = await player();
  const appId = String(700_000 + Math.floor(Math.random() * 99_999));
  const gameId = await game(false, appId);
  await db.userGame.create({
    data: {
      userId: user.id,
      gameId,
      unlockedCount: 15,
      totalCount: 21,
      playtimeMinutes: 5,
      reportedUnlockedCount: 15,
      achievementsCheckedAt: null,
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 403 })),
  );
  await auditSteamHistory(5, user.id);
  vi.unstubAllGlobals();
  expect((await progress(user.id, gameId)).achievementsCheckedAt).toEqual(expect.any(Date));
});

it('accepte un jeu à statistiques sans aucun succès', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ playerstats: { steamID: '1', gameName: 'Stats', success: true } }),
    ),
  );
  await expect(fetchUnlockList('1', 10)).resolves.toEqual({ unlocks: [], cleared: false });
  vi.unstubAllGlobals();
});
