import type { Prisma, Platform, TrophyType } from '#prisma';
import { db } from '../db';
import { familyKey } from '../family';
import { lockCardCatalog, refreshSharedTier, updateFamilyTiers } from '../card-rarity';
import {
  filterSteamProgress,
  lockSteamAccount,
  steamAchievementId,
  steamReviewUnlocks,
  withdrawSteamProgress,
} from '../steam-integrity';
import { invalidatePublicCache } from '../public-cache';
import { connectedUsers, publishChat } from './events';
import { slugify } from '#lib/slug';
import { logger } from '#lib/logger';

const log = logger('Catalogue');

const POINTS: Record<TrophyType, number> = {
  PLATINUM: 180,
  GOLD: 90,
  SILVER: 30,
  BRONZE: 15,
  ACHIEVEMENT: 10,
};

/** Les petits lots respectent les limites mémoire et transactionnelles du NAS. */
const ACHIEVEMENTS_PER_TRANSACTION = 25;

interface GameInput {
  platform: Platform;
  platformGameId: string;
  name: string;
  coverUrl?: string | null;
  headerUrl?: string | null;
  console?: string | null;
}

export interface AchievementInput {
  platformAchievementId: string;
  name: string;
  description: string;
  iconUrl?: string | null;
  iconLockedUrl?: string | null;
  hidden: boolean;
  trophyType: TrophyType;
  globalRarity?: number | null;
  points?: number;
}

export interface UnlockInput {
  platformAchievementId: string;
  unlockedAt: Date;
}

async function availableSlug(
  db: Prisma.TransactionClient,
  name: string,
  platform: Platform,
  platformGameId: string,
) {
  const base = slugify(name) || 'jeu';
  const taken = await db.game.findUnique({ where: { slug: base }, select: { id: true } });
  if (!taken) return base;
  const suffix = `${base}-${platform.toLowerCase()}-${slugify(platformGameId)}`;
  let slug = suffix;
  for (
    let attempt = 2;
    await db.game.findUnique({ where: { slug }, select: { id: true } });
    attempt++
  ) {
    slug = `${suffix}-${attempt}`;
  }
  return slug;
}

/** Un champ que l'appelant ne précise pas reste tel quel : il ne compte pas comme un changement. */
const kept = (next: string | null | undefined, current: string | null) =>
  next === undefined || next === current;

export async function upsertGame(input: GameInput) {
  const key = { platform: input.platform, platformGameId: input.platformGameId };
  // Le cas de loin le plus fréquent : un jeu connu, relu sans que rien n'ait bougé. Aucune
  // écriture ni verrou du catalogue, que toutes les synchronisations se disputaient sinon.
  const known = await db.game.findUnique({ where: { platform_platformGameId: key } });
  if (
    known &&
    known.name === input.name &&
    kept(input.coverUrl, known.coverUrl) &&
    kept(input.headerUrl, known.headerUrl) &&
    kept(input.console, known.console) &&
    (known.familyLocked || known.familyMatched || known.familyKey === familyKey(input.name))
  ) {
    return known;
  }
  return db.$transaction(async (db) => {
    // Les créations sont courtes et partagent l'espace unique des slugs.
    await lockCardCatalog(db);

    const existing = await db.game.findUnique({ where: { platform_platformGameId: key } });
    const fields = {
      name: input.name,
      coverUrl: input.coverUrl,
      headerUrl: input.headerUrl,
      console: input.console,
    };

    if (existing) {
      const family =
        existing.familyLocked || existing.familyMatched ? {} : { familyKey: familyKey(input.name) };
      const updated = await db.game.update({
        where: { id: existing.id },
        data: { ...fields, ...family },
      });
      if (updated.familyKey !== existing.familyKey) {
        await updateFamilyTiers(db, [
          existing.familyKey ?? existing.id,
          updated.familyKey ?? updated.id,
        ]);
        return db.game.findUniqueOrThrow({ where: { id: updated.id } });
      }
      return updated;
    }
    const created = await db.game.create({
      data: {
        ...key,
        ...fields,
        familyKey: familyKey(input.name),
        slug: await availableSlug(db, input.name, input.platform, input.platformGameId),
      },
    });
    await updateFamilyTiers(db, [created.familyKey ?? created.id]);
    return db.game.findUniqueOrThrow({ where: { id: created.id } });
  });
}

/** Les jeux déjà connus sans console la reçoivent, même sans nouveau succès à lire. */
export async function fillConsoles(platform: Platform, consoles: Map<string, string | null>) {
  const missing = await db.game.findMany({
    where: { platform, console: null, platformGameId: { in: [...consoles.keys()] } },
    select: { id: true, platformGameId: true },
  });
  for (const game of missing) {
    const label = consoles.get(game.platformGameId);
    if (label) await db.game.update({ where: { id: game.id }, data: { console: label } });
  }
}

/** Rattrape les jeux déjà connus, une fois, au démarrage. */
export async function fillGameTiers() {
  const games = await db.game.findMany({ where: { tier: null }, select: { id: true } });
  for (const { id } of games) await refreshSharedTier(id);
}

/** Remplace le catalogue de succès d'un jeu. Les succès déjà connus gardent leur identifiant. */
export async function saveAchievements(gameId: string, achievements: AchievementInput[]) {
  const before = await db.game.findUnique({
    where: { id: gameId },
    select: { totalAchievements: true },
  });
  for (let offset = 0; offset < achievements.length; offset += ACHIEVEMENTS_PER_TRANSACTION) {
    const batch = achievements.slice(offset, offset + ACHIEVEMENTS_PER_TRANSACTION);
    const writes = batch.map((a) => {
      const data = {
        name: a.name,
        description: a.description,
        iconUrl: a.iconUrl,
        iconLockedUrl: a.iconLockedUrl,
        hidden: a.hidden,
        trophyType: a.trophyType,
        globalRarity: a.globalRarity,
        points: a.points ?? POINTS[a.trophyType],
      };
      return db.achievement.upsert({
        where: {
          gameId_platformAchievementId: {
            gameId,
            platformAchievementId: a.platformAchievementId,
          },
        },
        // L'API ne décrit pas les succès cachés : ne pas effacer ce qui vient d'ailleurs.
        update: { ...data, description: a.description || undefined },
        create: { ...data, gameId, platformAchievementId: a.platformAchievementId },
      });
    });
    await db.$transaction(writes);
  }
  const pruned = await pruneAchievements(
    gameId,
    achievements.map((a) => a.platformAchievementId),
  );
  // Les upserts sont idempotents : une relance reprend un import interrompu par lots. Le total
  // est celui des lignes réellement gardées, le même que lit `saveProgress`.
  const totalAchievements = await db.achievement.count({ where: { gameId } });
  await db.game.update({
    where: { id: gameId },
    data: { totalAchievements, schemaSyncedAt: new Date() },
  });
  // Un succès ajouté (une extension) ou retiré change le pourcentage de tous les joueurs du jeu,
  // même de ceux qui n'y rejouent pas : leur progression suit ici.
  if (pruned || (before && before.totalAchievements !== totalAchievements)) {
    await refreshOwners(gameId);
  }
  await refreshSharedTier(gameId);
}

/** Recalcule la progression de tous les joueurs d'un jeu, depuis leurs déblocages enregistrés. */
async function refreshOwners(gameId: string) {
  await db.$executeRaw`
    UPDATE "UserGame" ug
    SET "unlockedCount" = p.unlocked, "totalCount" = p.total,
      completion = CASE WHEN p.total > 0 THEN p.unlocked * 100.0 / p.total ELSE 0 END,
      platinum = p.platinum, "lastUnlockedAt" = p.last
    FROM (
      SELECT ug2."userId", count(ua."achievementId")::int AS unlocked,
        (SELECT count(*)::int FROM "Achievement" WHERE "gameId" = ${gameId}) AS total,
        coalesce(bool_or(a."trophyType" = 'PLATINUM') FILTER (WHERE ua."achievementId" IS NOT NULL), false) AS platinum,
        max(ua."unlockedAt") AS last
      FROM "UserGame" ug2
      LEFT JOIN "Achievement" a ON a."gameId" = ug2."gameId"
      LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = ug2."userId"
      WHERE ug2."gameId" = ${gameId}
      GROUP BY ug2."userId"
    ) p
    WHERE ug."gameId" = ${gameId} AND ug."userId" = p."userId"`;
}

/**
 * Retire les succès que la plateforme a supprimés : sans cela, ils comptaient encore dans le
 * total des joueurs, qui ne pouvaient plus atteindre 100 %. Une liste vide ou amputée de plus
 * de la moitié ressemble davantage à une réponse incomplète qu'à un vrai retrait : rien n'est
 * alors supprimé, ni les déblocages ni les guides attachés.
 */
async function pruneAchievements(gameId: string, kept: string[]): Promise<number> {
  if (!kept.length) return 0;
  const stale = await db.achievement.findMany({
    where: { gameId, platformAchievementId: { notIn: kept } },
    select: { id: true },
  });
  if (!stale.length) return 0;
  if (stale.length > kept.length) {
    log.warn(`Catalogue réduit de ${stale.length} succès pour ${gameId} : retrait ignoré`);
    return 0;
  }
  // `saveAchievements` recalcule ensuite la progression des joueurs du jeu.
  await db.achievement.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  return stale.length;
}

/** Un succès qui vient de tomber : de quoi le montrer au joueur sans recharger sa page. */
interface NewUnlock {
  id: string;
  name: string;
  iconUrl: string | null;
}

interface SaveResult {
  /** Nombre de succès réellement ajoutés. */
  gained: number;
  /** Au plus cinq nouveaux succès : la page ne fête pas tout un premier import. */
  fresh: NewUnlock[];
  /** Succès retirés parce que la plateforme ne les montre plus, après confirmation. */
  removed: number;
}

/** Le délai minimal entre la lecture qui repère un retrait et celle qui le confirme. */
export const REMOVAL_CONFIRM = 60 * 60 * 1000;

/**
 * Les succès enregistrés que la plateforme ne montre plus. Rien n'est retiré sur une liste vide :
 * elle ressemble davantage à une réponse ratée qu'à une progression remise à zéro. Une première
 * lecture note le constat ; une seconde, au moins une heure plus tard, le confirme et retire
 * les succès encore absents. L'heure d'écart couvre aussi les succès que le suivi en direct
 * enregistre avant que la liste complète ne les montre. Renvoie `seenAt` à écrire sur le jeu.
 */
async function reviewRemovals(
  tx: Prisma.TransactionClient,
  userId: string,
  gameId: string,
  unlocks: UnlockInput[],
  confirmedSteamRead = false,
  now = Date.now(),
): Promise<{ seenAt: Date | null; removed: number } | undefined> {
  if (!unlocks.length && !confirmedSteamRead) return undefined;
  const reported = new Set(unlocks.map((unlock) => unlock.platformAchievementId));
  const stored = await tx.$queryRaw<{ achievementId: string; platformAchievementId: string }[]>`
    SELECT ua."achievementId", a."platformAchievementId"
    FROM "UserAchievement" ua
    JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE ua."userId" = ${userId} AND a."gameId" = ${gameId}`;
  const missing = stored.filter((row) => !reported.has(row.platformAchievementId));
  const seen = (
    await tx.userGame.findUnique({
      where: { userId_gameId: { userId, gameId } },
      select: { removalSeenAt: true },
    })
  )?.removalSeenAt;

  if (!missing.length) return seen ? { seenAt: null, removed: 0 } : undefined;
  if (!seen) return { seenAt: new Date(now), removed: 0 };
  if (now - seen.getTime() < REMOVAL_CONFIRM) return undefined;

  if (confirmedSteamRead) {
    await withdrawSteamProgress(
      tx,
      userId,
      gameId,
      missing.map((row) => row.platformAchievementId),
    );
  } else {
    await tx.userAchievement.deleteMany({
      where: { userId, achievementId: { in: missing.map((row) => row.achievementId) } },
    });
  }
  log.info('Succès retirés', { userId, gameId, count: missing.length });
  return { seenAt: null, removed: missing.length };
}

/**
 * Enregistre les déverrouillages d'un joueur et recalcule sa progression.
 * Renvoie le nombre de succès nouvellement obtenus et de quoi les annoncer.
 */
export type ProgressActivity = {
  playtimeMinutes?: number;
  offlinePlaytimeMinutes?: number;
  lastPlayedAt?: Date | null;
  achievementsCheckedAt?: Date;
};

export async function saveProgress(
  userId: string,
  gameId: string,
  unlocks: UnlockInput[],
  activity: ProgressActivity = {},
  /**
   * `complete` : `unlocks` est toute la liste que la plateforme donne pour ce jeu, pas un
   * extrait. Un succès enregistré qu'elle ne montre plus (progression réinitialisée) peut alors
   * être retiré, avec les garde-fous de `REMOVAL_CONFIRM`.
   */
  {
    complete = false,
    steamId,
    cleared = false,
  }: {
    complete?: boolean;
    steamId?: string;
    /** Steam a listé tous les succès du jeu, aucun obtenu : une remise à zéro certaine. */
    cleared?: boolean;
  } = {},
): Promise<SaveResult> {
  const result = await db.$transaction(
    async (tx) => {
      if (steamId) {
        await lockSteamAccount(tx, steamId);
        const account = await tx.linkedAccount.findUnique({
          where: { provider_providerUserId: { provider: 'STEAM', providerUserId: steamId } },
          select: { userId: true },
        });
        if (account?.userId !== userId)
          return { gained: 0, fresh: [], removed: 0, withdrawn: false, reviewChanged: false };
      }
      // Sérialise import complet et suivi en direct du même jeu pour ce joueur.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([userId, gameId])}, 0))::text`;
      const filtered = steamId
        ? await filterSteamProgress(
            tx,
            userId,
            gameId,
            steamId,
            unlocks,
            activity,
            complete,
            cleared,
          )
        : { unlocks, withdrawn: false, reviewChanged: false };
      const removal = complete
        ? await reviewRemovals(tx, userId, gameId, unlocks, Boolean(steamId))
        : undefined;
      return {
        ...(await writeProgress(tx, userId, gameId, filtered.unlocks, activity, {
          removal,
          reportedUnlockedCount: steamId ? unlocks.length : undefined,
        })),
        withdrawn: filtered.withdrawn || Boolean(removal?.removed),
        reviewChanged: filtered.reviewChanged,
      };
    },
    { timeout: 30_000 },
  );
  if (result.withdrawn) invalidatePublicCache();
  if (result.reviewChanged) await publishSteamReview(userId);
  return { gained: result.gained, fresh: result.fresh, removed: result.removed };
}

export async function publishSteamReview(userId: string | null) {
  if (userId) publishChat(userId, { type: 'steam-review' });
  const online = [...connectedUsers()].filter((id) => id !== userId);
  if (!online.length) return;
  const moderators = await db.user
    .findMany({
      where: { id: { in: online }, role: { in: ['ADMIN', 'MODERATOR'] } },
      select: { id: true },
    })
    .catch((cause: unknown) => {
      log.error('Notification de modération Steam :', cause);
      return [];
    });
  for (const moderator of moderators) publishChat(moderator.id, { type: 'steam-review' });
}

async function writeProgress(
  db: Prisma.TransactionClient,
  userId: string,
  gameId: string,
  unlocks: UnlockInput[],
  activity: ProgressActivity,
  {
    removal,
    reportedUnlockedCount,
  }: {
    removal?: { seenAt: Date | null; removed: number };
    reportedUnlockedCount?: number;
  } = {},
): Promise<SaveResult> {
  let gained = 0;
  const freshIds: string[] = [];
  // La taille du SQL et des résultats Prisma reste bornée, même pour 8 000 succès WoW.
  const batchSize = 250;
  for (let offset = 0; offset < unlocks.length; offset += batchSize) {
    const batch = unlocks.slice(offset, offset + batchSize);
    const platformIds = batch.map((row) => row.platformAchievementId);
    const known = await db.$queryRaw<{ id: string; platformAchievementId: string }[]>`
          SELECT id, "platformAchievementId" FROM "Achievement"
          WHERE "gameId" = ${gameId} AND "platformAchievementId" = ANY(${platformIds}::text[])`;
    const byPlatformId = new Map(known.map((row) => [row.platformAchievementId, row]));
    const pending = new Map<string, Date>();
    for (const unlock of batch) {
      const achievement = byPlatformId.get(unlock.platformAchievementId);
      if (achievement && !pending.has(achievement.id))
        pending.set(achievement.id, unlock.unlockedAt);
    }
    if (!pending.size) continue;
    // Deux tableaux paramétrés évitent de construire un gros arbre de requête Prisma.
    const ids = [...pending.keys()];
    const dates = [...pending.values()].map((date) => date.toISOString());
    // Le suivi en direct date un succès à sa détection, avant que Steam ne donne l'heure
    // exacte : une date plus ancienne remplace la précédente. `xmax = 0` distingue un
    // succès nouveau d'une date corrigée.
    const written = await db.$queryRaw<
      { achievementId: string; unlockedAt: Date; inserted: boolean }[]
    >`
          INSERT INTO "UserAchievement" ("userId", "achievementId", "unlockedAt")
          SELECT ${userId}, row.id, row.at
          FROM unnest(${ids}::text[], ${dates}::timestamp[]) AS row(id, at)
          ON CONFLICT ("userId", "achievementId") DO UPDATE SET "unlockedAt" = EXCLUDED."unlockedAt"
          WHERE EXCLUDED."unlockedAt" < "UserAchievement"."unlockedAt"
          RETURNING "achievementId", "unlockedAt", (xmax = 0) AS inserted`;
    const inserted = written.filter((row) => row.inserted);
    gained += inserted.length;
    for (const row of inserted.slice(0, 5 - freshIds.length)) freshIds.push(row.achievementId);
  }

  // Les agrégats restent dans Postgres : inutile de charger chaque succès déjà acquis.
  const [total, progress] = await Promise.all([
    db.achievement.count({ where: { gameId } }),
    db.$queryRaw<{ unlockedCount: number; lastUnlockedAt: Date | null; platinum: boolean }[]>`
          SELECT count(*)::int AS "unlockedCount", max(ua."unlockedAt") AS "lastUnlockedAt",
            coalesce(bool_or(a."trophyType" = 'PLATINUM'), false) AS platinum
          FROM "UserAchievement" ua
          JOIN "Achievement" a ON a.id = ua."achievementId"
          WHERE ua."userId" = ${userId} AND a."gameId" = ${gameId}`,
  ]);
  const { unlockedCount, lastUnlockedAt, platinum } = progress[0]!;
  const data = {
    unlockedCount,
    totalCount: total,
    completion: total > 0 ? (unlockedCount / total) * 100 : 0,
    platinum,
    lastUnlockedAt,
    ...(activity.playtimeMinutes !== undefined && {
      playtimeMinutes: activity.playtimeMinutes,
    }),
    ...(activity.offlinePlaytimeMinutes !== undefined && {
      offlinePlaytimeMinutes: activity.offlinePlaytimeMinutes,
    }),
    ...(activity.lastPlayedAt !== undefined && { lastPlayedAt: activity.lastPlayedAt }),
    ...(activity.achievementsCheckedAt !== undefined && {
      achievementsCheckedAt: activity.achievementsCheckedAt,
    }),
    ...(removal !== undefined && { removalSeenAt: removal.seenAt }),
    ...(reportedUnlockedCount !== undefined && { reportedUnlockedCount }),
  };
  await db.userGame.upsert({
    where: { userId_gameId: { userId, gameId } },
    update: data,
    create: { ...data, userId, gameId },
  });
  const fresh = freshIds.length
    ? await db.achievement.findMany({
        where: { id: { in: freshIds } },
        select: { id: true, name: true, iconUrl: true },
      })
    : [];
  return { gained, fresh, removed: removal?.removed ?? 0 };
}

export async function resolveSteamReview(
  id: string,
  version: Date,
  moderatorId: string,
  accepted: string[],
  decision: 'approve' | 'selected' | 'suspend',
  allowBatches: boolean,
) {
  const approveAll = decision === 'approve';
  const review = await db.$transaction(
    async (tx) => {
      const scope = await tx.steamIntegrityReview.findUnique({
        where: { id },
        select: { steamId: true },
      });
      if (!scope) return false;
      await lockSteamAccount(tx, scope.steamId);
      const current = await tx.steamIntegrityReview.findUniqueOrThrow({ where: { id } });
      if (
        current.openedAt.getTime() !== version.getTime() ||
        (!approveAll && current.status !== 'PENDING')
      ) {
        return false;
      }
      const selected = new Set(accepted);
      const rejected = approveAll
        ? []
        : [
            ...new Set([
              ...current.rejected,
              ...current.flagged.filter((key) => !selected.has(key)).map(steamAchievementId),
            ]),
          ];
      const approved = [
        ...new Set([
          ...current.approved,
          ...current.flagged.filter((key) => approveAll || selected.has(key)),
        ]),
      ];
      const suspendedAt = decision === 'suspend' ? (current.suspendedAt ?? new Date()) : null;
      await tx.steamIntegrityReview.update({
        where: { id },
        data: {
          status: rejected.length || suspendedAt ? 'REJECTED' : 'APPROVED',
          rejected,
          approved,
          suspendedAt,
          reviewedAt: new Date(),
          reviewedBy: moderatorId,
        },
      });
      if (approveAll && allowBatches) {
        await tx.game.updateMany({
          where: { id: current.gameId },
          data: { allowSteamBatches: true },
        });
      }
      const account = await tx.linkedAccount.findUnique({
        where: { provider_providerUserId: { provider: 'STEAM', providerUserId: scope.steamId } },
        select: { userId: true },
      });
      if (account && account.userId === current.userId) {
        const excluded = new Set(rejected);
        const unlocks = steamReviewUnlocks(current).filter(
          (unlock) => !excluded.has(unlock.platformAchievementId),
        );
        if (suspendedAt) await withdrawSteamProgress(tx, account.userId, current.gameId);
        else await writeProgress(tx, account.userId, current.gameId, unlocks, {});
      }
      return { userId: current.userId };
    },
    { timeout: 30_000 },
  );
  if (!review) return false;
  invalidatePublicCache();
  await publishSteamReview(review.userId);
  return true;
}

/** Au-delà, un succès retrouvé à la visite suivante n'est plus une nouvelle. */
const CATCH_UP_DAYS = 7;

/**
 * Les derniers succès du joueur, pour les fêter quand il revient sur le site : ceux
 * débloqués pendant qu'il n'avait pas la page ouverte n'ont encore rien montré. Ceux déjà
 * fêtés sur une de ses pages restent tus, quel que soit l'appareil.
 */
export async function recentUnlocks(userId: string, limit = 3) {
  const since = new Date(Date.now() - CATCH_UP_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.userAchievement.findMany({
    where: { userId, unlockedAt: { gte: since }, celebratedAt: null },
    orderBy: { unlockedAt: 'desc' },
    take: limit,
    select: {
      achievement: {
        select: {
          id: true,
          name: true,
          iconUrl: true,
          game: { select: { name: true, slug: true } },
        },
      },
    },
  });
  return rows.map(({ achievement }) => ({
    id: achievement.id,
    title: achievement.name,
    icon: achievement.iconUrl,
    game: achievement.game.name,
    slug: achievement.game.slug,
  }));
}

/** Ces succès viennent d'être envoyés à une page du joueur : plus aucun appareil ne les rejoue. */
export async function markCelebrated(userId: string, achievementIds: string[]) {
  if (!achievementIds.length) return;
  await db.userAchievement.updateMany({
    where: { userId, achievementId: { in: achievementIds }, celebratedAt: null },
    data: { celebratedAt: new Date() },
  });
}
