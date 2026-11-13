import { Prisma } from '#prisma';
import { RARITY_POINTS, SEASON, seasonState, type Season } from '#lib/season';
import { db } from '../db';
import { cardScore, tierCounts, visibleGames, type TierCounts } from './shared';

const BARELY_PLAYED_MINUTES = 60;

/** Un jeu lancé à peine une heure et jamais terminé, tiré au hasard. */
export async function barelyPlayedGame(userId: string, showAdult = false) {
  const games = await db.userGame.findMany({
    where: {
      userId,
      hidden: false,
      completion: { lt: 100 },
      playtimeMinutes: { gt: 0, lt: BARELY_PLAYED_MINUTES },
      game: { ...visibleGames(showAdult), headerUrl: { not: null } },
    },
    select: {
      playtimeMinutes: true,
      game: { select: { name: true, slug: true, headerUrl: true } },
    },
    take: 20,
  });
  const picked = games[Math.floor(Math.random() * games.length)];
  if (!picked?.game.headerUrl) return null;
  const { name, slug, headerUrl } = picked.game;
  return { name, slug, headerUrl, minutes: picked.playtimeMinutes };
}

/** Jeux du joueur qui compteront : ceux où il a un succès d'avant la saison. */
export async function seasonStartedGames(userId: string, season = SEASON) {
  if (seasonState(season) === 'ended') return new Set<string>();
  const rows = await db.achievement.findMany({
    where: { unlocks: { some: { userId, unlockedAt: { lt: season.startsAt } } } },
    distinct: ['gameId'],
    select: { gameId: true },
  });
  return new Set(rows.map((row) => row.gameId));
}

/** Une rafale ne prouve pas une partie jouée pendant la saison : elle ne rapporte rien. */
function seasonUnlocks({ startsAt, endsAt, burstPerSecond, burstPerMinute }: Season) {
  return Prisma.sql`
    SELECT ua."userId", a."gameId", a."globalRarity",
           count(*) OVER (
             PARTITION BY ua."userId", a."gameId", date_trunc('second', ua."unlockedAt")
           ) >= ${burstPerSecond}::int
           OR count(*) OVER (
             PARTITION BY ua."userId", a."gameId", date_trunc('minute', ua."unlockedAt")
           ) >= ${burstPerMinute}::int AS burst
    FROM "UserAchievement" ua
    JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE ua."unlockedAt" >= ${startsAt} AND ua."unlockedAt" < ${endsAt}`;
}

/** Points de saison : seuls comptent les jeux déjà commencés avant son ouverture. */
export async function seasonStats(season: Season) {
  const { startsAt, endsAt, completionBonus } = season;
  const ranking = await db.$queryRaw<
    {
      id: string;
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      isPublic: boolean;
      points: bigint;
      ignored: bigint;
      unlocked: bigint;
    }[]
  >`
    WITH unlocks AS (${seasonUnlocks(season)}), started AS (
      SELECT DISTINCT ua."userId", a."gameId"
      FROM "UserAchievement" ua
      JOIN "Achievement" a ON a.id = ua."achievementId"
      WHERE ua."unlockedAt" < ${startsAt}
    ), earned AS (
      SELECT u."userId",
             coalesce(sum(CASE
               WHEN u."globalRarity" IS NULL THEN ${RARITY_POINTS.uncommon}::int
               WHEN u."globalRarity" > 50 THEN ${RARITY_POINTS.common}::int
               WHEN u."globalRarity" >= 20 THEN ${RARITY_POINTS.uncommon}::int
               WHEN u."globalRarity" >= 5 THEN ${RARITY_POINTS.rare}::int
               ELSE ${RARITY_POINTS.epic}::int
             END) FILTER (WHERE NOT u.burst), 0) AS points,
             count(*) FILTER (WHERE u.burst) AS ignored
      FROM unlocks u
      JOIN started s ON s."userId" = u."userId" AND s."gameId" = u."gameId"
      GROUP BY 1
    ), finished AS (
      SELECT ug."userId", count(*) * ${completionBonus}::int AS points
      FROM "UserGame" ug
      JOIN started s ON s."userId" = ug."userId" AND s."gameId" = ug."gameId"
      WHERE ug.completion >= 100
        AND ug."lastUnlockedAt" >= ${startsAt} AND ug."lastUnlockedAt" < ${endsAt}
        AND NOT EXISTS (
          SELECT 1 FROM unlocks b
          WHERE b."userId" = ug."userId" AND b."gameId" = ug."gameId" AND b.burst
        )
      GROUP BY 1
    ), total AS (
      SELECT count(*) AS unlocked
      FROM unlocks ua
      JOIN "User" u ON u.id = ua."userId" AND u."isPublic"
      WHERE NOT ua.burst
    )
    SELECT u.id, u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame,
           u."frameMotionUrl", u."isPublic",
           (coalesce(e.points, 0) + coalesce(f.points, 0))::bigint AS points,
           coalesce(e.ignored, 0)::bigint AS ignored,
           t.unlocked
    FROM earned e
    FULL JOIN finished f USING ("userId")
    JOIN "User" u ON u.id = "userId"
    CROSS JOIN total t
    ORDER BY points DESC, u.handle`;

  // Sans aucune ligne, personne n'a rien débloqué pendant la saison.
  return {
    unlocked: Number(ranking[0]?.unlocked ?? 0),
    ranking: ranking.map(({ unlocked: _unlocked, ...row }) => ({
      ...row,
      points: Number(row.points),
      ignored: Number(row.ignored),
    })),
  };
}

export async function userStats(userId: string) {
  const [collection, unlocked, played] = await Promise.all([
    db.$queryRaw<(TierCounts & { games: bigint })[]>`
      SELECT count(*) AS games,
             count(*) FILTER (WHERE tier = 1) AS t1,
             count(*) FILTER (WHERE tier = 2) AS t2,
             count(*) FILTER (WHERE tier = 3) AS t3,
             count(*) FILTER (WHERE tier = 4) AS t4,
             count(*) FILTER (WHERE tier = 5) AS t5,
             count(*) FILTER (WHERE tier = 6) AS t6
      FROM (
        SELECT max(COALESCE(g.tier, 1)) FILTER (WHERE ug.completion >= 100) AS tier
        FROM "UserGame" ug
        JOIN "Game" g ON g.id = ug."gameId"
        WHERE ug."userId" = ${userId} AND NOT ug.hidden
        GROUP BY COALESCE(g."familyKey", g.id)
      ) families`,
    db.userAchievement.count({ where: { userId } }),
    // Toutes plateformes confondues ; un jeu caché par le joueur ne compte pas.
    db.$queryRaw<{ platform: string; minutes: bigint; ps4: bigint; ps5: bigint }[]>`
      SELECT g.platform::text AS platform, sum(ug."playtimeMinutes") AS minutes,
             sum(ug."ps4PlaytimeMinutes") AS ps4, sum(ug."ps5PlaytimeMinutes") AS ps5
      FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
      WHERE ug."userId" = ${userId} AND NOT ug.hidden AND ug."playtimeMinutes" > 0
      GROUP BY g.platform ORDER BY g.platform
    `,
  ]);
  const tiers = tierCounts(collection[0]);
  return {
    games: Number(collection[0]?.games ?? 0),
    tiers,
    unlocked,
    points: cardScore(tiers),
    playtimeMinutes: played.reduce((total, row) => total + Number(row.minutes), 0),
    playtimeByPlatform: played.flatMap(({ platform, minutes, ps4, ps5 }) =>
      platform === 'PSN'
        ? [
            { platform: 'PS4', minutes: Number(ps4) },
            { platform: 'PS5', minutes: Number(ps5) },
            { platform: 'PSN', minutes: Number(minutes - ps4 - ps5) },
          ].filter((row) => row.minutes > 0)
        : [{ platform, minutes: Number(minutes) }],
    ),
  };
}
