import { Prisma, type TrophyType } from '#prisma';
import { copiesFor } from '#lib/collection';
import { liveReactions } from '../activity';
import { db } from '../db';
import { publicGames, publicUser } from './shared';

/** Les jeux terminés : 100 % des succès, DLC compris. */
export const RARE_CARD = {
  completion: { gte: 100 },
} satisfies Prisma.UserGameWhereInput;

/**
 * Une ligne par édition terminée (plateforme ou console) : le fil compte les exemplaires ainsi et
 * les moments de niveau s'y datent. `where` restreint les joueurs lus.
 */
const finishedEditions = (where: Prisma.Sql) => Prisma.sql`
  SELECT ug."userId", ug."lastUnlockedAt" AS at, g.name, g.slug, g."headerUrl", g.platform,
         g."adultOnly", g."contentCheckedAt", g.tier,
         COALESCE(g."familyKey", g."slug") AS family,
         COALESCE(g."console", g.platform::text) AS edition
  FROM "UserGame" ug
  JOIN "Game" g ON g.id = ug."gameId"
  WHERE ug."completion" >= 100 AND NOT ug.hidden AND ${where}`;

/**
 * Les exemplaires de chaque carte du fil : une édition terminée par plateforme ou console, comme
 * au moment de la révélation. Une seule requête pour toutes les cartes affichées.
 */
async function copiesInFeed(
  rows: { userId: string; game: { slug: string; familyKey: string | null } }[],
) {
  const userIds = [...new Set(rows.map((row) => row.userId))];
  if (userIds.length === 0) return new Map<string, number>();
  const counts = await db.$queryRaw<{ userId: string; family: string; copies: bigint }[]>`
    WITH finished AS (${finishedEditions(Prisma.sql`ug."userId" IN (${Prisma.join(userIds)})`)})
    SELECT "userId", family, count(DISTINCT edition) AS copies
    FROM finished
    GROUP BY 1, 2`;
  return new Map(
    counts.map((row) => [`${row.userId}|${row.family}`, copiesFor(Number(row.copies))]),
  );
}

/** Dernières cartes obtenues par les profils publics, à la date du dernier succès. */
export async function cardFeed(showAdult = false, limit = 12, viewerId?: string) {
  const rows = await db.userGame.findMany({
    where: {
      ...RARE_CARD,
      hidden: false,
      user: { isPublic: true },
      game: showAdult ? {} : publicGames,
      lastUnlockedAt: { not: null },
    },
    orderBy: { lastUnlockedAt: 'desc' },
    take: limit,
    select: {
      lastUnlockedAt: true,
      userId: true,
      user: {
        select: publicUser,
      },
      game: {
        select: { id: true, name: true, slug: true, headerUrl: true, tier: true, familyKey: true },
      },
    },
  });
  const [copies, reactions] = await Promise.all([
    copiesInFeed(rows),
    liveReactions(
      rows.map((row) => ({ ownerId: row.userId, gameId: row.game.id })),
      viewerId,
    ),
  ]);
  return rows.map(({ lastUnlockedAt, userId, user, game: { id, familyKey, ...game } }) => ({
    user,
    game: { ...game, tier: game.tier ?? 1 },
    copies: copies.get(`${userId}|${familyKey ?? game.slug}`) ?? 1,
    unlockedAt: lastUnlockedAt as Date,
    reactions: reactions.get(`${userId}/${id}`) ?? { counts: {}, mine: null },
  }));
}

interface FeedFilter {
  /** Seuls ces joueurs : les amis ou le clan. */
  userIds?: string[];
  /** Seulement les exploits : un platine ou un succès très rare. */
  feats?: boolean;
  limit?: number;
}

/** Sous ce pourcentage de joueurs, un succès mérite d'apparaître dans le fil de tout le site. */
const FEAT_RARITY = 1;

const FEAT_ACHIEVEMENT = {
  OR: [{ trophyType: 'PLATINUM' }, { globalRarity: { lt: FEAT_RARITY } }],
} satisfies Prisma.AchievementWhereInput;

/** Un jeu vient de donner un exploit à ce joueur ? Seuls les succès récents comptent. */
export async function hasRecentFeat(userId: string, gameId: string, since: Date) {
  const feats = await db.userAchievement.count({
    where: { userId, unlockedAt: { gte: since }, achievement: { gameId, ...FEAT_ACHIEVEMENT } },
  });
  return feats > 0;
}

/**
 * Les exploits récents, retrouvés à partir du catalogue. Les chercher au fil des déblocages
 * obligeait à relire chaque succès débloqué du site (27 000 en production, 650 ms sur le NAS) :
 * ici le catalogue répond par son index partiel, et seuls les exploits retrouvés sont relus.
 */
async function recentFeats(showAdult: boolean, userIds: string[] | undefined, limit: number) {
  const rows = await db.$queryRaw<
    {
      userId: string;
      unlockedAt: Date;
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      id: string;
      gameId: string;
      name: string;
      iconUrl: string | null;
      trophyType: TrophyType;
      globalRarity: number | null;
      gameName: string;
      gameSlug: string;
    }[]
  >`
    WITH feats AS MATERIALIZED (
      SELECT a.id
      FROM "Achievement" a
      JOIN "Game" g ON g.id = a."gameId"
      WHERE (a."trophyType" = 'PLATINUM' OR a."globalRarity" < ${FEAT_RARITY})
        ${
          showAdult
            ? Prisma.empty
            : Prisma.sql`AND NOT g."adultOnly"
          AND (g.platform <> 'STEAM' OR g."contentCheckedAt" IS NOT NULL)`
        }
    ), recent AS MATERIALIZED (
      SELECT ua."userId", ua."achievementId", ua."unlockedAt"
      FROM "UserAchievement" ua
      JOIN "User" u ON u.id = ua."userId" AND u."isPublic"
      JOIN feats f ON f.id = ua."achievementId"
      ${userIds ? Prisma.sql`WHERE ua."userId" = ANY(${userIds}::text[])` : Prisma.empty}
      ORDER BY ua."unlockedAt" DESC
      LIMIT ${limit}
    )
    SELECT r."userId", r."unlockedAt", u.handle, u."displayName", u."avatarUrl",
           u."avatarMotionUrl", u.frame, u."frameMotionUrl",
           a.id, a."gameId", a.name, a."iconUrl", a."trophyType", a."globalRarity",
           g.name AS "gameName", g.slug AS "gameSlug"
    FROM recent r
    JOIN "User" u ON u.id = r."userId"
    JOIN "Achievement" a ON a.id = r."achievementId"
    JOIN "Game" g ON g.id = a."gameId"
    ORDER BY r."unlockedAt" DESC`;
  return rows.map((row) => ({
    userId: row.userId,
    unlockedAt: row.unlockedAt,
    user: {
      handle: row.handle,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      avatarMotionUrl: row.avatarMotionUrl,
      frame: row.frame,
      frameMotionUrl: row.frameMotionUrl,
    },
    achievement: {
      id: row.id,
      gameId: row.gameId,
      name: row.name,
      iconUrl: row.iconUrl,
      trophyType: row.trophyType,
      globalRarity: row.globalRarity,
      game: { name: row.gameName, slug: row.gameSlug },
    },
  }));
}

export async function activityFeed(
  showAdult = false,
  { userIds, feats, limit = 30 }: FeedFilter = {},
) {
  if (userIds?.length === 0) return [];
  const rows = feats
    ? await recentFeats(showAdult, userIds, limit * 3)
    : await db.userAchievement.findMany({
        where: {
          user: { isPublic: true },
          ...(userIds && { userId: { in: userIds } }),
          achievement: {
            game: showAdult ? {} : publicGames,
          },
        },
        orderBy: { unlockedAt: 'desc' },
        // De la marge : les jeux cachés par leur joueur sont retirés ensuite.
        take: limit * 3,
        select: {
          userId: true,
          unlockedAt: true,
          user: {
            select: publicUser,
          },
          achievement: {
            select: {
              id: true,
              gameId: true,
              name: true,
              iconUrl: true,
              trophyType: true,
              globalRarity: true,
              game: { select: { name: true, slug: true } },
            },
          },
        },
      });
  const hidden = await db.userGame.findMany({
    where: { hidden: true, userId: { in: [...new Set(rows.map((row) => row.userId))] } },
    select: { userId: true, gameId: true },
  });
  const secret = new Set(hidden.map((row) => `${row.userId}:${row.gameId}`));
  return rows
    .filter((row) => !secret.has(`${row.userId}:${row.achievement.gameId}`))
    .slice(0, limit)
    .map(({ userId: _userId, ...row }) => row);
}

/** Chaque plateforme terminée fait monter la carte : Or, puis Diamant, Prismatique, Légendaire. */
async function tierMoments(showAdult: boolean, limit: number) {
  const rows = await db.$queryRaw<
    {
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      name: string;
      slug: string;
      headerUrl: string | null;
      at: Date;
      copies: bigint;
      tier: number | null;
    }[]
  >`
    WITH finished AS (
      ${finishedEditions(Prisma.sql`ug."lastUnlockedAt" IS NOT NULL
        AND "userId" IN (SELECT id FROM "User" WHERE "isPublic")`)}
    ), reached AS (
      SELECT *, min(at) OVER (PARTITION BY "userId", family, edition) AS reached
      FROM finished
    ), ranked AS (
      SELECT *, dense_rank() OVER (PARTITION BY "userId", family ORDER BY reached, edition) AS copies
      FROM reached
    )
    SELECT u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame,
           u."frameMotionUrl", r.name, r.slug, r."headerUrl", r.at, r.copies, r.tier
    FROM ranked r
    JOIN "User" u ON u.id = r."userId"
    WHERE r.at = r.reached
      AND (${showAdult} OR (NOT r."adultOnly"
        AND (r.platform <> 'STEAM' OR r."contentCheckedAt" IS NOT NULL)))
    ORDER BY r.at DESC
    LIMIT ${limit}`;
  return rows.map(({ name, slug, headerUrl, at, copies, tier, ...user }) => ({
    kind: 'card' as const,
    key: `${user.handle}-${slug}-${copies}`,
    user,
    game: { name, slug, headerUrl },
    tier: tier ?? 1,
    copies: Math.min(Number(copies), 4),
    at,
  }));
}

/** Le fil de tout le site : les cartes obtenues et les exploits, pas chaque succès. */
export async function highlights(showAdult = false, limit = 30) {
  const [cards, feats] = await Promise.all([
    tierMoments(showAdult, limit),
    activityFeed(showAdult, { feats: true, limit }),
  ]);
  return [
    ...cards,
    ...feats.map((feat) => ({
      ...feat,
      kind: 'feat' as const,
      key: `${feat.user.handle}-${feat.achievement.id}`,
      at: feat.unlockedAt,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}
