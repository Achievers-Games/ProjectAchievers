import { Prisma, type SteamIntegrityReview } from '#prisma';
import type { ProgressActivity, UnlockInput } from './sync/store';

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

// Ces jeux peuvent importer une progression ou présentent des lots récurrents sur plusieurs comptes.
export const MANUAL_REVIEW_APPS = new Set(['359550', '230410', '2357570']);

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

/**
 * Un lot à la même seconde ne prouve rien seul : Steam en produit aussi quand un jeu relit sa
 * sauvegarde ou reçoit des succès gagnés hors ligne. Le score pèse les autres traces du joueur.
 * Positif, il plaide pour une vraie partie ; négatif, pour un outil de déblocage.
 */
export type TrustSignal =
  | { kind: 'playtime_peers'; weight: number; minutes: number; median: number; peers: number }
  | { kind: 'playtime_rate'; weight: number; minutes: number; perAchievement: number }
  | { kind: 'playtime_unknown'; weight: 0 }
  | { kind: 'offline'; weight: number; minutes: number }
  | { kind: 'history'; weight: number; count: number }
  | { kind: 'near_impossible'; weight: number; count: number };

export type SteamTrust = {
  score: number;
  verdict: 'trusted' | 'review' | 'cheat';
  signals: TrustSignal[];
};

export type TrustEvidence = {
  /** Succès montrés par Steam sur ce jeu. */
  unlocked: number;
  /** Minutes de jeu ; `null` quand Steam ne les montre pas (profil privé ou zéro). */
  playtime: number | null;
  offline: number;
  /** Temps médian des autres membres arrivés au moins aussi loin, et leur nombre. */
  peerMedian: number | null;
  peers: number;
  /** Moments de déblocage distincts avant le premier lot douteux. */
  history: number;
  /** Succès du lot que presque personne n'a sur Steam (moins de 0,1 %). */
  nearImpossible: number;
};

export const TRUSTED_SCORE = 3;
export const CHEAT_SCORE = -3;
const MIN_PEERS = 3;
const OFFLINE_MINUTES = 30;
const RARE_PERCENT = 0.1;

export function steamTrust(evidence: TrustEvidence): SteamTrust {
  const signals: TrustSignal[] = [];
  const { playtime, unlocked } = evidence;
  if (!playtime) {
    signals.push({ kind: 'playtime_unknown', weight: 0 });
  } else if (evidence.peerMedian && evidence.peers >= MIN_PEERS) {
    const ratio = playtime / evidence.peerMedian;
    signals.push({
      kind: 'playtime_peers',
      weight: ratio >= 0.4 ? 3 : ratio < 0.1 ? -3 : ratio < 0.25 ? -1 : 0,
      minutes: playtime,
      median: evidence.peerMedian,
      peers: evidence.peers,
    });
  } else {
    const perAchievement = playtime / Math.max(unlocked, 1);
    signals.push({
      kind: 'playtime_rate',
      weight:
        perAchievement >= 30
          ? 3
          : perAchievement >= 15
            ? 2
            : perAchievement < 1
              ? -3
              : perAchievement < 3
                ? -1
                : 0,
      minutes: playtime,
      perAchievement: Math.round(perAchievement * 10) / 10,
    });
  }
  if (evidence.offline >= OFFLINE_MINUTES) {
    signals.push({ kind: 'offline', weight: 2, minutes: evidence.offline });
  }
  if (evidence.history >= 3) {
    signals.push({ kind: 'history', weight: 1, count: evidence.history });
  }
  if (evidence.nearImpossible >= 2) {
    signals.push({ kind: 'near_impossible', weight: -2, count: evidence.nearImpossible });
  }
  const score = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const verdict = score >= TRUSTED_SCORE ? 'trusted' : score <= CHEAT_SCORE ? 'cheat' : 'review';
  return { score, verdict, signals };
}

/** Rassemble les traces du joueur sur ce jeu, puis calcule le score. */
async function assessSteamTrust(
  tx: Prisma.TransactionClient,
  {
    userId,
    gameId,
    steamId,
    unlocks,
    flagged,
    activity,
  }: {
    userId: string;
    gameId: string;
    steamId: string;
    unlocks: UnlockInput[];
    flagged: string[];
    activity: ProgressActivity;
  },
) {
  const [account, row, rarities] = await Promise.all([
    tx.linkedAccount.findUnique({
      where: { provider_providerUserId: { provider: 'STEAM', providerUserId: steamId } },
      select: { playtimeHidden: true },
    }),
    tx.userGame.findUnique({
      where: { userId_gameId: { userId, gameId } },
      select: { playtimeMinutes: true, offlinePlaytimeMinutes: true },
    }),
    tx.achievement.findMany({
      where: {
        gameId,
        platformAchievementId: { in: [...new Set(flagged.map(steamAchievementId))] },
      },
      select: { globalRarity: true },
    }),
  ]);
  const minutes = Math.max(activity.playtimeMinutes ?? 0, row?.playtimeMinutes ?? 0);
  const playtime = account?.playtimeHidden || !minutes ? null : minutes;
  // Les pairs : d'autres membres arrivés au moins aussi loin, sans revue en attente sur ce jeu.
  const [peers] = await tx.$queryRaw<{ median: number | null; count: bigint }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ug."playtimeMinutes")::float AS median,
      count(*) AS count
    FROM "UserGame" ug
    WHERE ug."gameId" = ${gameId} AND ug."userId" <> ${userId} AND ug."playtimeMinutes" > 0
      AND ug."unlockedCount" >= ${Math.ceil(unlocks.length * 0.8)}
      AND NOT EXISTS (
        SELECT 1 FROM "SteamIntegrityReview" r
        WHERE r."gameId" = ug."gameId" AND r."userId" = ug."userId"
          AND (r.status = 'PENDING' OR r."suspendedAt" IS NOT NULL)
      )`;
  const firstFlagged = Math.min(...flagged.map(stampOf));
  const flaggedIds = new Set(flagged.map(steamAchievementId));
  const history = new Set(
    unlocks
      .map((unlock) => unlock.unlockedAt.getTime())
      .filter(
        (at, index) =>
          at >= MIN_DATE &&
          at < firstFlagged &&
          !flaggedIds.has(unlocks[index]!.platformAchievementId),
      ),
  ).size;
  return steamTrust({
    unlocked: unlocks.length,
    playtime,
    offline: Math.max(activity.offlinePlaytimeMinutes ?? 0, row?.offlinePlaytimeMinutes ?? 0),
    peerMedian: peers?.median ?? null,
    peers: Number(peers?.count ?? 0),
    history,
    nearImpossible: rarities.filter(
      (achievement) => achievement.globalRarity !== null && achievement.globalRarity < RARE_PERCENT,
    ).length,
  });
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
  activity: ProgressActivity = {},
  complete = false,
) {
  const scope = { steamId_gameId: { steamId, gameId } };
  const gameSelect = {
    platformGameId: true,
    totalAchievements: true,
    allowSteamBatches: true,
    name: true,
  };
  const [game, stored] = await Promise.all([
    tx.game.findUniqueOrThrow({ where: { id: gameId }, select: gameSelect }),
    tx.steamIntegrityReview.findUnique({ where: scope }),
  ]);
  if (stored?.suspendedAt && stored.userId !== userId) {
    await withdrawSteamProgress(tx, userId, gameId);
  }
  const reset = await steamReset(tx, stored, unlocks, complete);
  if (reset.waiting) return { unlocks, withdrawn: false, reviewChanged: false };
  // Après une remise à zéro, la nouvelle partie passe les contrôles comme un jeu neuf.
  const previous = reset.review;
  const snapshot = unlocks.map((unlock) => ({
    id: unlock.platformAchievementId,
    at: unlock.unlockedAt.getTime(),
  }));
  const rejected = previous?.rejected ?? [];
  const detected = steamSuspects(unlocks, game.totalAchievements, steamBatchException(game));
  const fresh = detected.filter(
    (key) => !previous?.approved.includes(key) && !rejected.includes(steamAchievementId(key)),
  );
  const wasPending = previous?.status === 'PENDING' && previous.flagged.length > 0;
  const candidates = [...new Set([...(wasPending ? previous.flagged : []), ...fresh])];
  if (!previous && !candidates.length) return { unlocks, withdrawn: false, reviewChanged: false };

  // Les jeux qui importent une progression restent toujours en revue manuelle.
  const trust = candidates.length
    ? await assessSteamTrust(tx, {
        userId,
        gameId,
        steamId,
        unlocks,
        flagged: candidates,
        activity,
      })
    : null;
  const autoApproved =
    trust?.verdict === 'trusted' &&
    !MANUAL_REVIEW_APPS.has(game.platformGameId) &&
    !previous?.suspendedAt;
  const flagged = autoApproved ? [] : candidates;
  const approved = [
    ...new Set([...(previous?.approved ?? []), ...(autoApproved ? candidates : [])]),
  ];
  const opened =
    !autoApproved &&
    (fresh.some((key) => !previous?.flagged.includes(key)) || (!previous && flagged.length > 0));
  // Un score accablant suspend le jeu d'emblée ; la modération peut toujours tout rétablir.
  const caught = trust?.verdict === 'cheat' && flagged.length > 0 && !previous?.suspendedAt;

  const now = new Date();
  const trustData = trust ? { trust: trust as unknown as Prisma.InputJsonValue } : {};
  const current = await tx.steamIntegrityReview.upsert({
    where: scope,
    create: {
      steamId,
      userId,
      gameId,
      snapshot,
      flagged,
      approved,
      rejected,
      ...trustData,
      // Validé d'office sans jamais avoir été ouvert : aucune notification à envoyer.
      ...(autoApproved && { status: 'APPROVED', openedAt: new Date(0), reviewedAt: now }),
      ...(caught && { suspendedAt: now }),
    },
    update: {
      userId,
      snapshot,
      flagged,
      approved,
      ...trustData,
      // Des succès revenus : la lecture vide précédente était un raté.
      ...(unlocks.length > 0 && { emptySeenAt: null }),
      ...(opened && { status: 'PENDING', openedAt: now, reviewedAt: null, reviewedBy: null }),
      ...(autoApproved &&
        wasPending && { status: 'APPROVED', openedAt: now, reviewedAt: now, reviewedBy: null }),
      ...(caught && { suspendedAt: now, openedAt: now }),
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
  const released = autoApproved && wasPending;
  return {
    unlocks: suspended
      ? []
      : unlocks.filter((unlock) => !excluded.has(unlock.platformAchievementId)),
    withdrawn: suspended || excluded.size > 0 || newBlocks.length > 0 || released || reset.done,
    reviewChanged:
      opened ||
      caught ||
      released ||
      reset.done ||
      newBlocks.length > 0 ||
      previous?.userId !== userId,
  };
}

/** Une liste vide peut venir d'un raté de Steam : une seconde, une heure après, la confirme. */
const RESET_CONFIRM = 60 * 60 * 1000;

/**
 * Un joueur bloqué peut repartir de zéro : il réinitialise les succès du jeu sur Steam, puis le
 * refait. La remise à zéro se voit quand Steam ne montre plus aucun déblocage antérieur au
 * blocage : soit des succès tous obtenus depuis, soit une liste vide confirmée une heure plus tard. Le blocage est alors levé et la suite repasse les contrôles habituels.
 */
async function steamReset(
  tx: Prisma.TransactionClient,
  review: SteamIntegrityReview | null,
  unlocks: UnlockInput[],
  complete: boolean,
): Promise<{ review: SteamIntegrityReview | null; waiting: boolean; done: boolean }> {
  const unchanged = { review, waiting: false, done: false };
  if (!review || !complete) return unchanged;
  const blocked =
    Boolean(review.suspendedAt) || review.rejected.length > 0 || review.status === 'PENDING';
  if (!blocked) return unchanged;
  // Les déblocages en cause datent d'avant que le site ne note le blocage : un seul encore là, et
  // le jeu n'a pas été remis à zéro.
  const blockedAt = Math.max(
    review.openedAt.getTime(),
    review.suspendedAt?.getTime() ?? 0,
    review.reviewedAt?.getTime() ?? 0,
  );
  if (unlocks.some((unlock) => unlock.unlockedAt.getTime() <= blockedAt)) return unchanged;

  const now = new Date();
  if (!unlocks.length) {
    if (!review.emptySeenAt) {
      await tx.steamIntegrityReview.update({
        where: { id: review.id },
        data: { emptySeenAt: now },
      });
    }
    if (!review.emptySeenAt || now.getTime() - review.emptySeenAt.getTime() < RESET_CONFIRM) {
      return { review, waiting: true, done: false };
    }
  }
  const cleared = await tx.steamIntegrityReview.update({
    where: { id: review.id },
    data: {
      status: 'APPROVED',
      suspendedAt: null,
      flagged: [],
      approved: [],
      rejected: [],
      snapshot: [],
      trust: Prisma.DbNull,
      emptySeenAt: null,
      resetAt: now,
      openedAt: now,
      reviewedAt: now,
      reviewedBy: null,
    },
  });
  return { review: cleared, waiting: false, done: true };
}
