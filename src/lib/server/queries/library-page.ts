import { Prisma, type Platform } from '#prisma';
import { SEASON, seasonState } from '#lib/season';
import { db } from '../db';
import { PAGE_SIZE } from './shared';
import { matchesGameName } from './game-name';

interface LibraryFilters {
  q?: string;
  platform?: Platform;
  consoles?: string[];
  sort: 'nom' | 'recent' | 'progression' | 'succes' | 'rarete';
  direction?: 'asc' | 'desc';
  page: number;
  // « non-possedes » ne passe jamais par ici : ces jeux ne sont pas dans la bibliothèque.
  status?: 'termines' | 'restants' | 'saison' | 'caches' | 'non-possedes';
  tier?: number;
  showAdult?: boolean;
}

/** Paginer les familles avant de charger leurs images et leurs versions. */
export async function libraryPage(
  filters: LibraryFilters,
  ownerId: string,
  viewerId: string | null,
) {
  const eligible = ownerId === viewerId && seasonState(SEASON) !== 'ended';
  const seasonGames = eligible
    ? Prisma.sql`season_games AS (
        SELECT DISTINCT a."gameId"
        FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
        WHERE ua."userId" = ${ownerId} AND ua."unlockedAt" < ${SEASON.startsAt}
      ),`
    : Prisma.empty;
  const platform = filters.platform
    ? Prisma.sql`g.platform = ${filters.platform}::"Platform" ${filters.consoles ? Prisma.sql`AND string_to_array(regexp_replace(COALESCE(g.console, ''), '^Xbox ', ''), '/') && ${filters.consoles}::text[]` : Prisma.empty}`
    : Prisma.sql`true`;
  const ongoing = filters.status === 'restants' || filters.status === 'saison';
  const direction = filters.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const nameDirection =
    filters.sort === 'nom' && filters.direction === 'desc' ? direction : Prisma.sql`ASC`;
  const order =
    filters.sort === 'succes'
      ? Prisma.sql`"totalAchievements" ${direction},`
      : filters.sort === 'recent'
        ? Prisma.sql`"lastUnlockedAt" ${direction} NULLS LAST,`
        : filters.sort === 'rarete'
          ? Prisma.sql`rarity ${direction}, shown ${direction},`
          : filters.sort === 'progression'
            ? ongoing
              ? Prisma.sql`shown ${direction},`
              : Prisma.sql`copies ${direction}, advancement ${direction},`
            : Prisma.empty;
  const ordering = Prisma.sql`${order} name COLLATE "fr-x-icu" ${nameDirection}, family`;
  const name = filters.q ? matchesGameName(Prisma.sql`g.name`, filters.q) : Prisma.sql`true`;
  const [result] = await db.$queryRaw<
    { total: bigint; entries: { family: string; seasonEligible: boolean }[] }[]
  >`
    WITH ${seasonGames} versions AS (
      SELECT g.id, g.name, g.slug, g."totalAchievements", COALESCE(g.tier, 1) AS tier,
        ug.completion, ug."lastUnlockedAt", COALESCE(g."familyKey", g.id) AS family,
        COALESCE(g.console, g.platform::text) AS edition,
        ${eligible ? Prisma.sql`sg."gameId" IS NOT NULL` : Prisma.sql`false`} AS started,
        ${platform} AS matching_platform,
        ${name} AS matching_name,
        row_number() OVER (PARTITION BY COALESCE(g."familyKey", g.id) ORDER BY ug.completion DESC, g.slug) AS position
      FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
      ${eligible ? Prisma.sql`LEFT JOIN season_games sg ON sg."gameId" = g.id` : Prisma.empty}
      WHERE ug."userId" = ${ownerId} AND ug.hidden = ${filters.status === 'caches'}
        ${filters.showAdult ? Prisma.empty : Prisma.sql`AND NOT g."adultOnly"`}
    ), finished AS (
      SELECT DISTINCT family, edition FROM versions WHERE completion >= 100
    ), next_versions AS (
      SELECT v.family, max(v.completion) AS completion
      FROM versions v LEFT JOIN finished done ON done.family = v.family AND done.edition = v.edition
      WHERE done.family IS NULL AND v.completion > 0
      GROUP BY v.family
    ), summaries AS (
      SELECT family, LEAST(count(DISTINCT edition) FILTER (WHERE completion >= 100), 4)::int AS copies,
        COALESCE(max(tier) FILTER (WHERE completion >= 100), 0) AS earned,
        bool_or(started AND completion < 100) AS "seasonEligible",
        bool_or(matching_platform) AS matching_platform, bool_or(matching_name) AS matching_name
      FROM versions GROUP BY family
    ), cards AS (
      SELECT best.family, best.name, best."totalAchievements", best."lastUnlockedAt", s."seasonEligible",
        s.copies, COALESCE(NULLIF(s.earned, 0), best.tier) AS rarity,
        COALESCE(CASE WHEN s.copies > 0 THEN n.completion END, best.completion) AS shown,
        CASE WHEN s.earned > 0 THEN s.earned * 10 + s.copies + COALESCE(n.completion, 0) / 100.0
          ELSE best.completion / 100.0 END AS advancement
      FROM versions best JOIN summaries s ON s.family = best.family
      LEFT JOIN next_versions n ON n.family = best.family
      WHERE best.position = 1 AND s.matching_platform AND s.matching_name
        ${filters.tier ? Prisma.sql`AND COALESCE(NULLIF(s.earned, 0), best.tier) = ${filters.tier}` : Prisma.empty}
        ${filters.status === 'termines' ? Prisma.sql`AND s.earned > 0` : Prisma.empty}
        ${filters.status === 'restants' ? Prisma.sql`AND ((s.copies > 0 AND n.completion IS NOT NULL) OR (best.completion < 100 AND best."totalAchievements" > 0))` : Prisma.empty}
        ${filters.status === 'saison' ? Prisma.sql`AND s."seasonEligible"` : Prisma.empty}
    ), page AS (
      SELECT family, "seasonEligible", row_number() OVER (ORDER BY ${ordering}) AS position
      FROM cards ORDER BY ${ordering}
      LIMIT ${PAGE_SIZE} OFFSET ${(filters.page - 1) * PAGE_SIZE}
    )
    SELECT (SELECT count(*) FROM cards) AS total,
      COALESCE(jsonb_agg(jsonb_build_object('family', family, 'seasonEligible', "seasonEligible") ORDER BY position), '[]'::jsonb) AS entries
    FROM page`;
  return { total: Number(result.total), entries: result.entries };
}
