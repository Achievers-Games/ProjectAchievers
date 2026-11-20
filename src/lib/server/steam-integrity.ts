import type { Prisma, SteamIntegrityReview } from '#prisma';
import type { UnlockInput } from './sync/store';

const WINDOW = 2 * 60 * 60 * 1000;
const THRESHOLD = 10;
const MIN_DATE = Date.UTC(2003, 8, 12); // Lancement de Steam.

export const steamUnlockKey = (unlock: UnlockInput) =>
  `${unlock.unlockedAt.getTime()}:${unlock.platformAchievementId}`;
export const steamAchievementId = (key: string) => key.slice(key.indexOf(':') + 1);
const stampOf = (key: string) => Number(key.slice(0, key.indexOf(':')));

export function steamSuspects(
  unlocks: UnlockInput[],
  total: number,
  allowBatches: boolean,
  now = Date.now(),
) {
  const batches = new Map<number, Set<string>>();
  const outliers = new Set<string>();
  for (const unlock of unlocks) {
    const at = unlock.unlockedAt.getTime();
    const key = steamUnlockKey(unlock);
    // Zéro signifie que Steam n'a pas donné d'heure de déblocage.
    if (at === 0) continue;
    if (at < MIN_DATE || at > now + 15 * 60_000) {
      outliers.add(key);
      continue;
    }
    if (allowBatches) continue;
    const batch = batches.get(at) ?? new Set<string>();
    batch.add(key);
    batches.set(at, batch);
  }
  for (const batch of batches.values()) {
    // Un jeu à des centaines de succès demande un lot proportionnellement plus grand.
    if (!isSteamReviewBatch(batch.size, total)) continue;
    for (const key of batch) outliers.add(key);
  }
  return [...outliers].sort();
}

function isSteamReviewBatch(size: number, total: number) {
  return (
    size >= 20 || (size >= THRESHOLD && size >= total * 0.2) || (size >= 8 && size >= total * 0.65)
  );
}

type Evidence = {
  gameId: string;
  flagged: string[];
  game: {
    platformGameId: string;
    totalAchievements: number;
    allowSteamBatches: boolean;
    name: string;
  };
};

export const steamBatchException = (game: Evidence['game']) =>
  game.allowSteamBatches || /^Zup!/i.test(game.name) || game.platformGameId === '1258080';

// Déblocage intégral officiel (Unturned), progression importée ou lots récurrents sur plusieurs
// comptes (Rainbow Six Siege, Warframe, Overwatch). Ces lots demandent une décision humaine.
const MANUAL_REVIEW_APPS = new Set(['304930', '359550', '230410', '2357570']);

/** Croise les lots de titres distincts dans une même fenêtre de deux heures. */
export function corroboratedGames(evidence: Evidence[], currentGame: string, now = Date.now()) {
  const batches: { gameId: string; at: number; nearComplete: boolean }[] = [];
  for (const row of evidence) {
    if (
      steamBatchException(row.game) ||
      row.game.totalAchievements >= 500 ||
      MANUAL_REVIEW_APPS.has(row.game.platformGameId)
    )
      continue;
    const counts = new Map<number, number>();
    for (const key of row.flagged) {
      const at = stampOf(key);
      if (at >= MIN_DATE && at <= now + 15 * 60_000) counts.set(at, (counts.get(at) ?? 0) + 1);
    }
    for (const [at, count] of counts) {
      if (count >= Math.max(THRESHOLD, Math.ceil(row.game.totalAchievements * 0.2))) {
        batches.push({
          gameId: row.gameId,
          at,
          nearComplete: count >= Math.max(20, Math.ceil(row.game.totalAchievements * 0.7)),
        });
      }
    }
  }
  batches.sort((a, b) => a.at - b.at);
  const result = new Set<string>();
  const active = new Map<string, number>();
  const nearComplete = new Map<string, number>();
  let start = 0;
  for (const batch of batches) {
    active.set(batch.gameId, (active.get(batch.gameId) ?? 0) + 1);
    if (batch.nearComplete)
      nearComplete.set(batch.gameId, (nearComplete.get(batch.gameId) ?? 0) + 1);
    while (batch.at - batches[start]!.at > WINDOW) {
      const expired = batches[start++]!;
      removeBatch(active, expired.gameId);
      if (expired.nearComplete) removeBatch(nearComplete, expired.gameId);
    }
    if (active.size >= 3 && active.has(currentGame)) {
      for (const gameId of active.keys()) result.add(gameId);
    }
    if (nearComplete.size >= 2 && nearComplete.has(currentGame)) {
      for (const gameId of nearComplete.keys()) result.add(gameId);
    }
  }
  return [...result].sort();
}

function removeBatch(batches: Map<string, number>, gameId: string) {
  const count = batches.get(gameId)!;
  if (count === 1) batches.delete(gameId);
  else batches.set(gameId, count - 1);
}

export function steamReviewUnlocks(review: Pick<SteamIntegrityReview, 'snapshot'>): UnlockInput[] {
  const snapshot = review.snapshot as { id: string; at: number }[];
  return snapshot.map(({ id, at }) => ({ platformAchievementId: id, unlockedAt: new Date(at) }));
}

export function excludedSteamUnlocks(
  review: Pick<
    SteamIntegrityReview,
    'snapshot' | 'status' | 'suspendedAt' | 'flagged' | 'rejected'
  >,
) {
  const excluded = new Set([
    ...review.rejected,
    ...(review.status === 'PENDING' ? review.flagged.map(steamAchievementId) : []),
  ]);
  return new Map(
    steamReviewUnlocks(review)
      .filter((unlock) => review.suspendedAt || excluded.has(unlock.platformAchievementId))
      .map((unlock) => [unlock.platformAchievementId, unlock.unlockedAt]),
  );
}

export async function lockSteamAccount(tx: Prisma.TransactionClient, steamId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`steam-integrity:${steamId}`}, 0))::text`;
}

/** Retire les succès des données qui alimentent les scores, et annule les éclats liés. */
export async function withdrawSteamProgress(
  tx: Prisma.TransactionClient,
  userId: string,
  gameId: string,
  platformIds?: string[],
) {
  await tx.$executeRaw`
    DELETE FROM "UserAchievement" ua USING "Achievement" a
    WHERE ua."achievementId" = a.id AND a."gameId" = ${gameId} AND ua."userId" = ${userId}
      AND (${platformIds === undefined} OR a."platformAchievementId" = ANY(${platformIds ?? []}::text[]))`;
  if (platformIds === undefined) {
    await tx.userGame.updateMany({
      where: { userId, gameId },
      data: { completion: 0, unlockedCount: 0, platinum: false, lastUnlockedAt: null },
    });
  }
}

export async function filterSteamProgress(
  tx: Prisma.TransactionClient,
  userId: string,
  gameId: string,
  steamId: string,
  unlocks: UnlockInput[],
) {
  const scope = { steamId_gameId: { steamId, gameId } };
  const gameSelect = {
    platformGameId: true,
    totalAchievements: true,
    allowSteamBatches: true,
    name: true,
  };
  const [game, previous] = await Promise.all([
    tx.game.findUniqueOrThrow({ where: { id: gameId }, select: gameSelect }),
    tx.steamIntegrityReview.findUnique({ where: scope }),
  ]);
  if (previous?.suspendedAt && previous.userId !== userId) {
    await withdrawSteamProgress(tx, userId, gameId);
  }
  const snapshot = unlocks.map((unlock) => ({
    id: unlock.platformAchievementId,
    at: unlock.unlockedAt.getTime(),
  }));
  const approved = previous?.approved ?? [];
  const rejected = previous?.rejected ?? [];
  const detected = steamSuspects(unlocks, game.totalAchievements, steamBatchException(game));
  const fresh = detected.filter(
    (key) => !approved.includes(key) && !rejected.includes(steamAchievementId(key)),
  );
  const flagged = [
    ...new Set([...(previous?.status === 'PENDING' ? previous.flagged : []), ...fresh]),
  ];
  const opened =
    fresh.some((key) => !previous?.flagged.includes(key)) || (!previous && flagged.length > 0);
  if (!previous && !flagged.length) return { unlocks, withdrawn: false, reviewChanged: false };

  const now = new Date();
  const current = await tx.steamIntegrityReview.upsert({
    where: scope,
    create: { steamId, userId, gameId, snapshot, flagged, approved, rejected },
    update: {
      userId,
      snapshot,
      flagged,
      ...(opened && { status: 'PENDING', openedAt: now, reviewedAt: null, reviewedBy: null }),
    },
  });
  const peers = flagged.length
    ? await tx.steamIntegrityReview.findMany({
        where: { steamId, userId, status: 'PENDING' },
        include: { game: { select: gameSelect } },
      })
    : [];
  const severe = corroboratedGames(peers, gameId, now.getTime());
  const newBlocks = peers.filter((row) => severe.includes(row.gameId) && !row.suspendedAt);
  for (const row of newBlocks) {
    await tx.steamIntegrityReview.update({
      where: { id: row.id },
      data: { suspendedAt: now, openedAt: now },
    });
    if (row.gameId !== gameId) await withdrawSteamProgress(tx, userId, row.gameId);
  }
  const suspended = Boolean(current.suspendedAt) || severe.includes(gameId);
  const excluded = new Set([...rejected, ...flagged.map(steamAchievementId)]);
  if (suspended) await withdrawSteamProgress(tx, userId, gameId);
  else if (excluded.size) await withdrawSteamProgress(tx, userId, gameId, [...excluded]);
  return {
    unlocks: suspended
      ? []
      : unlocks.filter((unlock) => !excluded.has(unlock.platformAchievementId)),
    withdrawn: suspended || excluded.size > 0 || newBlocks.length > 0,
    reviewChanged: opened || newBlocks.length > 0 || previous?.userId !== userId,
  };
}
