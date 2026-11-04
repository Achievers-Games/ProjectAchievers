import { Prisma } from '@prisma/client';
import { db } from '../db';
import { TIER_POINTS, tierCounts, type TierCounts } from './shared';

export type LeaderboardPeriod = 'semaine' | 'mois' | 'tout';

const PERIOD_DAYS: Record<LeaderboardPeriod, number | null> = {
  semaine: 7,
  mois: 30,
  tout: null,
};

export async function leaderboard(period: LeaderboardPeriod, limit = 20, userIds?: string[]) {
  const days = PERIOD_DAYS[period];
  const since = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  const rows = await db.$queryRaw<
    {
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      unlocked: bigint;
    }[]
  >`
    SELECT u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame, u."frameMotionUrl",
           count(*) AS unlocked
    FROM "UserAchievement" ua
    JOIN "User" u ON u.id = ua."userId" AND u."isPublic"
    WHERE ua."unlockedAt" >= ${since}
      ${userIds ? Prisma.sql`AND u.id = ANY(${userIds}::text[])` : Prisma.empty}
    GROUP BY u.id
    ORDER BY unlocked DESC, u.handle
    LIMIT ${limit}`;
  return rows.map((row) => ({ ...row, unlocked: Number(row.unlocked) }));
}

/** Classement des collections : seules les cartes comptent, pas le nombre de succès. */
async function rankedCollectors(limit: number) {
  const rows = await db.$queryRaw<
    ({
      id: string;
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      score: bigint;
    } & TierCounts)[]
  >`
    WITH cards AS (
      SELECT ug."userId", COALESCE(g.tier, 1) AS tier
      FROM "UserGame" ug
      JOIN "Game" g ON g.id = ug."gameId"
      WHERE ug.completion >= 100 AND NOT ug.hidden
      GROUP BY ug."userId", COALESCE(g."familyKey", g.id), COALESCE(g.tier, 1)
    ), counts AS (
      SELECT "userId",
             count(*) FILTER (WHERE tier = 1) AS t1,
             count(*) FILTER (WHERE tier = 2) AS t2,
             count(*) FILTER (WHERE tier = 3) AS t3,
             count(*) FILTER (WHERE tier = 4) AS t4,
             count(*) FILTER (WHERE tier = 5) AS t5,
             count(*) FILTER (WHERE tier = 6) AS t6
      FROM cards
      GROUP BY "userId"
    )
    SELECT u.id, u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame,
           u."frameMotionUrl", c.t1, c.t2, c.t3, c.t4, c.t5, c.t6,
           (c.t1 * ${TIER_POINTS[0]} + c.t2 * ${TIER_POINTS[1]} + c.t3 * ${TIER_POINTS[2]}
             + c.t4 * ${TIER_POINTS[3]} + c.t5 * ${TIER_POINTS[4]} + c.t6 * ${TIER_POINTS[5]})::bigint
             AS score
    FROM counts c
    JOIN "User" u ON u.id = c."userId" AND u."isPublic"
    ORDER BY score DESC, u.handle
    LIMIT ${limit}`;

  return rows.map(({ t1, t2, t3, t4, t5, t6, score, ...user }) => {
    const tiers = tierCounts({ t1, t2, t3, t4, t5, t6 });
    return {
      ...user,
      tiers,
      cards: tiers.reduce((sum, count) => sum + count, 0),
      score: Number(score),
    };
  });
}

export async function collectors(limit = 100) {
  const rows = await rankedCollectors(limit);
  return rows.map(({ id: _id, ...row }) => row);
}

/** Tout le classement, avec les identifiants : réservé à l'attribution des récompenses. */
export const allCollectors = () => rankedCollectors(Number.MAX_SAFE_INTEGER);

export type Collector = Awaited<ReturnType<typeof collectors>>[number];
