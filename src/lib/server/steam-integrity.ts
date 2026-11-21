import { Prisma, type SteamIntegrityReview } from '#prisma';
import type { ProgressActivity, UnlockInput } from './sync/store';
import { lureGameFor } from './lure-games';
import { revokeShards } from './shards';

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
    crossProgress: boolean;
    name: string;
  };
};

export const steamBatchException = (game: Evidence['game']) =>
  game.allowSteamBatches || /^Zup!/i.test(game.name) || game.platformGameId === '1258080';

/** Croise les lots de titres distincts dans une même fenêtre de deux heures. */
export function corroboratedGames(evidence: Evidence[], currentGame: string, now = Date.now()) {
  const batches: { gameId: string; at: number; nearComplete: boolean }[] = [];
  for (const row of evidence) {
    if (
      steamBatchException(row.game) ||
      row.game.totalAchievements >= 500 ||
      row.game.crossProgress
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
  | { kind: 'playtime_reference'; weight: number; minutes: number; expected: number }
  | { kind: 'playtime_unknown'; weight: 0 }
  | { kind: 'offline'; weight: number; minutes: number }
  | { kind: 'history'; weight: number; count: number }
  | { kind: 'near_impossible'; weight: number; count: number }
  | { kind: 'cross_progress'; weight: 0 }
  | { kind: 'pace'; weight: 0 }
  | {
      kind: 'other_platform';
      weight: number;
      platform: string;
      completion: number;
      minutes: number;
    };

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
  /** Temps attendu pour cette progression d'après Lure, quand les membres sont trop peu. */
  expected?: number | null;
  /** Moments de déblocage distincts avant le premier lot douteux. */
  history: number;
  /** Succès du lot que presque personne n'a sur Steam (moins de 0,1 %). */
  nearImpossible: number;
  /** Le jeu reprend une progression d'ailleurs : peu de temps sur Steam ne dit rien. */
  crossProgress?: boolean;
  /** Repéré au rythme, sans lot : trop de succès pour le temps joué. */
  pace?: boolean;
  /** Le même jeu sur un autre compte lié du joueur (Xbox, PlayStation…), le plus avancé. */
  otherPlatform?: { platform: string; completion: number; minutes: number } | null;
};

export const TRUSTED_SCORE = 3;
/**
 * Le temps de jeu seul ne valide jamais : des outils le font monter sans jouer (ArchiSteamFarm).
 * Il faut un second signal indépendant (hors ligne, historique, autre plateforme) pour passer.
 */
const PLAYTIME_MAX = 2;
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
      weight: ratio >= 0.4 ? PLAYTIME_MAX : ratio < 0.1 ? -3 : ratio < 0.25 ? -1 : 0,
      minutes: playtime,
      median: evidence.peerMedian,
      peers: evidence.peers,
    });
  } else if (evidence.expected) {
    const ratio = playtime / evidence.expected;
    signals.push({
      kind: 'playtime_reference',
      weight: ratio >= 0.4 ? PLAYTIME_MAX : ratio < 0.1 ? -3 : ratio < 0.25 ? -1 : 0,
      minutes: playtime,
      expected: evidence.expected,
    });
  } else {
    const perAchievement = playtime / Math.max(unlocked, 1);
    signals.push({
      kind: 'playtime_rate',
      weight:
        perAchievement >= 15 ? PLAYTIME_MAX : perAchievement < 1 ? -3 : perAchievement < 3 ? -1 : 0,
      minutes: playtime,
      perAchievement: Math.round(perAchievement * 10) / 10,
    });
  }
  const other = evidence.otherPlatform;
  const playedElsewhere = Boolean(other && (other.completion >= 50 || other.minutes >= 600));
  // Un temps Steam faible n'accuse personne quand la progression vient d'ailleurs : jeu connu
  // pour la reprendre, ou vraie partie vérifiée sur un autre compte lié.
  const imported = Boolean(evidence.crossProgress) || playedElsewhere;
  const time = signals[0]!;
  if (imported && time.weight < 0) time.weight = 0;
  if (evidence.crossProgress) signals.push({ kind: 'cross_progress', weight: 0 });
  if (evidence.pace) signals.push({ kind: 'pace', weight: 0 });
  if (other && (other.completion > 0 || other.minutes > 0)) {
    // Vérifié par le site lui-même : une vraie partie ailleurs vaut une validation.
    signals.push({ kind: 'other_platform', weight: playedElsewhere ? 3 : 1, ...other });
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
  const verdict =
    score >= TRUSTED_SCORE ? 'trusted' : score <= CHEAT_SCORE && !imported ? 'cheat' : 'review';
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
    onlineCap,
    crossProgress,
    pace,
    game,
  }: {
    userId: string;
    gameId: string;
    steamId: string;
    unlocks: UnlockInput[];
    flagged: string[];
    activity: ProgressActivity;
    /** Le temps connecté noté quand le lot a été repéré : ce qui a suivi ne compte pas. */
    onlineCap: number | null;
    crossProgress: boolean;
    pace: boolean;
    game: { platformGameId: string; totalAchievements: number };
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
  // Le temps total de Steam additionne le jeu connecté et hors ligne (`withOfflineTime`).
  const total = Math.max(activity.playtimeMinutes ?? 0, row?.playtimeMinutes ?? 0);
  const offline = Math.max(activity.offlinePlaytimeMinutes ?? 0, row?.offlinePlaytimeMinutes ?? 0);
  const online = Math.max(0, total - offline);
  const counted = (onlineCap === null ? online : Math.min(online, onlineCap)) + offline;
  const playtime = account?.playtimeHidden || !counted ? null : counted;
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
  // Le même jeu ailleurs, reconnu par sa famille (même nom d'une plateforme à l'autre).
  const [other] = await tx.$queryRaw<{ platform: string; completion: number; minutes: number }[]>`
    SELECT g.platform::text AS platform, ug.completion, ug."playtimeMinutes" AS minutes
    FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
    WHERE ug."userId" = ${userId} AND g.platform <> 'STEAM'
      AND g."familyKey" = (SELECT "familyKey" FROM "Game" WHERE id = ${gameId})
    ORDER BY ug.completion DESC, ug."playtimeMinutes" DESC
    LIMIT 1`;
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
  const trust = steamTrust({
    unlocked: unlocks.length,
    playtime,
    offline,
    crossProgress,
    pace,
    expected: await expectedMinutes(tx, game, unlocks.length),
    otherPlatform: other ?? null,
    peerMedian: peers?.median ?? null,
    peers: Number(peers?.count ?? 0),
    history,
    nearImpossible: rarities.filter(
      (achievement) => achievement.globalRarity !== null && achievement.globalRarity < RARE_PERCENT,
    ).length,
  });
  return { trust, online };
}

/** Sous une heure pour tout finir, un jeu se boucle trop vite pour juger le rythme sur ce temps. */
const MIN_REFERENCE = 60;

/**
 * Le temps qu'il faut d'ordinaire pour cette progression, d'après le temps complétionniste de Lure
 * (100 % du jeu) au prorata des succès obtenus. Un jeu pas encore demandé à Lure l'est en
 * arrière-plan : la référence servira à la lecture suivante.
 */
async function expectedMinutes(
  tx: Prisma.TransactionClient,
  game: { platformGameId: string; totalAchievements: number },
  unlocked: number,
) {
  const lure = await tx.lureGame.findUnique({
    where: { steamAppId: game.platformGameId },
    select: { found: true, completionistMinutes: true },
  });
  if (!lure) {
    void lureGameFor({
      platform: 'STEAM',
      platformGameId: game.platformGameId,
      familyKey: null,
    }).catch(() => undefined);
    return null;
  }
  const full = lure.found ? lure.completionistMinutes : null;
  if (!full || full < MIN_REFERENCE || !game.totalAchievements) return null;
  return Math.round(full * Math.min(1, unlocked / game.totalAchievements));
}

/** Steam ne compte le temps de jeu que depuis 2009 : un succès plus ancien ne dit rien du rythme. */
const PACE_FROM = Date.UTC(2009, 3, 1);
/** En dessous, quelques succès rapides sont normaux (tutoriel, premier niveau). */
const PACE_MIN_UNLOCKS = 10;
/** Des succès que la moitié des joueurs ont : souvent obtenus en quelques secondes, par tous. */
const PACE_COMMON_RARITY = 50;

/**
 * Les succès d'un jeu débloqués à un rythme impossible : moins d'une minute de jeu par succès, sur
 * au moins dix succès, quand les autres membres arrivés aussi loin ont joué dix fois plus. C'est la
 * trace d'un outil qui les débloque un par un, espacés, sans jamais former de lot. Rien n'est
 * signalé sans temps de jeu connu (profil privé, pas encore lu), ni sur des succès que tout le
 * monde obtient en passant.
 */
async function steamPaceSuspects(
  tx: Prisma.TransactionClient,
  {
    userId,
    gameId,
    steamId,
    unlocks,
    activity,
    game,
  }: {
    userId: string;
    gameId: string;
    steamId: string;
    unlocks: UnlockInput[];
    activity: ProgressActivity;
    game: { platformGameId: string; totalAchievements: number };
  },
) {
  const tracked = unlocks.filter((unlock) => unlock.unlockedAt.getTime() >= PACE_FROM);
  if (tracked.length < PACE_MIN_UNLOCKS) return [];
  const [account, row] = await Promise.all([
    tx.linkedAccount.findUnique({
      where: { provider_providerUserId: { provider: 'STEAM', providerUserId: steamId } },
      select: { playtimeHidden: true },
    }),
    tx.userGame.findUnique({
      where: { userId_gameId: { userId, gameId } },
      select: { playtimeMinutes: true },
    }),
  ]);
  const minutes = Math.max(activity.playtimeMinutes ?? 0, row?.playtimeMinutes ?? 0);
  if (account?.playtimeHidden || !minutes) return [];
  const expected = await expectedMinutes(tx, game, tracked.length);
  // Au moins une minute par succès, et au moins un dixième du temps attendu : rien à voir.
  if (minutes >= tracked.length && (expected === null || minutes >= expected * 0.1)) return [];
  const ids = tracked.map((unlock) => unlock.platformAchievementId);
  const [stats] = await tx.$queryRaw<
    { rarity: number | null; median: number | null; peers: bigint }[]
  >`
    SELECT
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY a."globalRarity")::float
        FROM "Achievement" a
        WHERE a."gameId" = ${gameId} AND a."platformAchievementId" = ANY(${ids}::text[])
          AND a."globalRarity" IS NOT NULL) AS rarity,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ug."playtimeMinutes")::float AS median,
      count(ug."userId") AS peers
    FROM "UserGame" ug
    WHERE ug."gameId" = ${gameId} AND ug."userId" <> ${userId} AND ug."playtimeMinutes" > 0
      AND ug."unlockedCount" >= ${Math.ceil(tracked.length * 0.8)}`;
  if (stats?.rarity != null && stats.rarity >= PACE_COMMON_RARITY) return [];
  // Assez de membres aussi avancés, qui n'ont pas joué tellement plus : le jeu est juste court.
  const suspects = tracked.map(steamUnlockKey);
  // Les autres membres d'abord, puis le temps complétionniste de Lure, puis une minute par succès.
  if (Number(stats?.peers ?? 0) >= 3 && stats?.median) {
    return minutes >= stats.median * 0.1 ? [] : suspects;
  }
  if (expected !== null) return minutes >= expected * 0.1 ? [] : suspects;
  return minutes >= tracked.length ? [] : suspects;
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
  const removed = await tx.$queryRaw<{ achievementId: string }[]>`
    DELETE FROM "UserAchievement" ua USING "Achievement" a
    WHERE ua."achievementId" = a.id AND a."gameId" = ${gameId} AND ua."userId" = ${userId}
      AND (${platformIds === undefined} OR a."platformAchievementId" = ANY(${platformIds ?? []}::text[]))
    RETURNING ua."achievementId"`;
  await revokeShards(
    tx,
    userId,
    gameId,
    removed.map((row) => row.achievementId),
  );
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
  cleared = false,
) {
  const scope = { steamId_gameId: { steamId, gameId } };
  const gameSelect = {
    platformGameId: true,
    totalAchievements: true,
    allowSteamBatches: true,
    crossProgress: true,
    name: true,
  };
  const [game, stored] = await Promise.all([
    tx.game.findUniqueOrThrow({ where: { id: gameId }, select: gameSelect }),
    tx.steamIntegrityReview.findUnique({ where: scope }),
  ]);
  if (stored?.suspendedAt && stored.userId !== userId) {
    await withdrawSteamProgress(tx, userId, gameId);
  }
  const reset = await steamReset(tx, stored, unlocks, complete, cleared);
  if (reset.waiting) return { unlocks, withdrawn: false, reviewChanged: false };
  // Après une remise à zéro, la nouvelle partie passe les contrôles comme un jeu neuf.
  const previous = reset.review;
  const snapshot = unlocks.map((unlock) => ({
    id: unlock.platformAchievementId,
    at: unlock.unlockedAt.getTime(),
  }));
  const rejected = previous?.rejected ?? [];
  // Les lots à la même seconde, et la progression trop rapide pour le temps joué : un outil qui
  // débloque les succès un par un, espacés, ne forme jamais de lot.
  const paced =
    complete && !steamBatchException(game) && !game.crossProgress
      ? await steamPaceSuspects(tx, { userId, gameId, steamId, unlocks, activity, game })
      : [];
  const detected = [
    ...new Set([
      ...steamSuspects(unlocks, game.totalAchievements, steamBatchException(game)),
      ...paced,
    ]),
  ];
  const fresh = detected.filter(
    (key) => !previous?.approved.includes(key) && !rejected.includes(steamAchievementId(key)),
  );
  const wasPending = previous?.status === 'PENDING' && previous.flagged.length > 0;
  const candidates = [...new Set([...(wasPending ? previous.flagged : []), ...fresh])];
  if (!previous && !candidates.length) return { unlocks, withdrawn: false, reviewChanged: false };

  // Le temps connecté se fige au premier examen d'un lot, et le reste tant qu'il est en attente :
  // un nouveau lot ajouté après des heures à laisser tourner le jeu ne le relève pas.
  const frozen = wasPending ? (previous.flaggedPlaytime ?? null) : null;
  const assessed = candidates.length
    ? await assessSteamTrust(tx, {
        userId,
        gameId,
        steamId,
        unlocks,
        flagged: candidates,
        activity,
        onlineCap: frozen,
        crossProgress: game.crossProgress,
        pace: paced.some((key) => candidates.includes(key)),
        game,
      })
    : null;
  const trust = assessed?.trust ?? null;
  // Une suspension automatique tombe si les traces du joueur la démentent ensuite (temps hors ligne
  // arrivé plus tard). Celle qu'un modérateur a confirmée, avec ses succès refusés, reste.
  const moderatorSuspended =
    Boolean(previous?.suspendedAt) &&
    (previous?.status !== 'PENDING' || (previous?.rejected.length ?? 0) > 0);
  const autoApproved = trust?.verdict === 'trusted' && !moderatorSuspended;
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
  // Zéro au premier examen veut dire « pas encore lu » (profil privé, bibliothèque en cours) : rien
  // n'est figé, le premier temps connu le sera.
  const flaggedPlaytime = flagged.length ? (frozen ?? (assessed?.online || null)) : null;
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
      flaggedPlaytime,
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
      flaggedPlaytime,
      // Des succès revenus : la lecture vide précédente était un raté.
      ...(unlocks.length > 0 && { emptySeenAt: null }),
      ...(opened && { status: 'PENDING', openedAt: now, reviewedAt: null, reviewedBy: null }),
      ...(autoApproved &&
        wasPending && {
          status: 'APPROVED',
          suspendedAt: null,
          openedAt: now,
          reviewedAt: now,
          reviewedBy: null,
        }),
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
 * blocage : des succès tous obtenus depuis, ou tous les succès du jeu listés à zéro par Steam (levée
 * immédiate). Une liste vide sans ce détail est confirmée une heure plus tard. Le blocage est alors levé et la suite repasse les contrôles habituels.
 */
async function steamReset(
  tx: Prisma.TransactionClient,
  review: SteamIntegrityReview | null,
  unlocks: UnlockInput[],
  complete: boolean,
  cleared: boolean,
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
  // Une liste vide sans la liste complète de Steam pour la confirmer attend une seconde lecture.
  if (!unlocks.length && !cleared) {
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
  const fresh = await tx.steamIntegrityReview.update({
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
  return { review: fresh, waiting: false, done: true };
}
