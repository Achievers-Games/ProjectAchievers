import { Prisma, type Platform } from '#prisma';
import { db } from './db';

/** Pour l'API partenaires et la modération : une médiane qui engage, sur vingt mesures. */
export const COMPLETION_TIME_MIN_SAMPLE = 20;
/** Sur la fiche du jeu, la médiane s'affiche dès cinq mesures, avec le nombre de joueurs. */
export const COMPLETION_TIME_DISPLAY_SAMPLE = 5;
/** Un joueur qui a relancé le jeu plus tard a ajouté des heures après son 100 % : écarté. */
const BACKFILL_GRACE = '2 days';
const COMPLETION_OBSERVATION_WINDOW = 24 * 60 * 60 * 1000;

// L'ordre et le catalogue de la plateforme définissent le périmètre, pas le titre ni le nombre
// de succès. Une extension (ou une liste remplacée à taille égale) produit une autre empreinte.
const achievementScope = Prisma.sql`md5(jsonb_agg(a."platformAchievementId" ORDER BY a."platformAchievementId")::text)`;

/** Fige le compteur lu près du dernier succès. Une relecture ne change pas cette mesure. */
export async function recordCompletionTimes(
  tx: Prisma.TransactionClient,
  userId: string,
  readings: { id: string; minutes: number }[],
  platform?: Platform,
  observedAt = new Date(),
) {
  const measured = readings.filter(
    ({ minutes }) => Number.isInteger(minutes) && minutes > 0 && minutes <= 2_147_483_647,
  );
  if (!measured.length) return;
  const since = new Date(observedAt.getTime() - COMPLETION_OBSERVATION_WINDOW);
  const matchGame = platform
    ? Prisma.sql`g.platform = ${platform}::"Platform" AND g."platformGameId" = reading.id`
    : Prisma.sql`g.id = reading.id`;
  await tx.$executeRaw`
    INSERT INTO "GameCompletionSample" ("userId", "gameId", scope, minutes, "completedAt", "observedAt")
    SELECT ug."userId", g.id, catalog.scope, reading.minutes, ug."lastUnlockedAt", ${observedAt}
    FROM unnest(${measured.map(({ id }) => id)}::text[], ${measured.map(({ minutes }) => minutes)}::int[])
      AS reading(id, minutes)
    JOIN "Game" g ON ${matchGame}
    JOIN "UserGame" ug ON ug."gameId" = g.id AND ug."userId" = ${userId}
    CROSS JOIN LATERAL (
      SELECT ${achievementScope} AS scope, count(*) AS total
      FROM "Achievement" a WHERE a."gameId" = g.id
    ) catalog
    WHERE ug.completion >= 100 AND catalog.total > 0 AND ug."unlockedCount" = catalog.total
      AND ug."lastUnlockedAt" BETWEEN ${since} AND ${observedAt}
      AND NOT ug.hidden AND NOT g."crossProgress"
      AND NOT EXISTS (
        SELECT 1 FROM "LinkedAccount" la
        WHERE la."userId" = ug."userId" AND g.platform = 'STEAM'
          AND la.provider = 'STEAM' AND la."playtimeHidden"
      )
    ON CONFLICT ("userId", "gameId", scope) DO UPDATE SET
      minutes = EXCLUDED.minutes, "completedAt" = EXCLUDED."completedAt", "observedAt" = EXCLUDED."observedAt"
    WHERE "GameCompletionSample"."completedAt" < EXCLUDED."completedAt"
  `;
}

/** Médiane des premiers relevés admissibles, pour le catalogue de succès actuellement affiché. */
export async function completionTimes(
  gameIds: string[],
  tx: Prisma.TransactionClient = db,
  excludeUserId?: string,
  minSample = COMPLETION_TIME_MIN_SAMPLE,
) {
  const result = new Map<string, { median: number; sample: number }>();
  if (gameIds.length === 0) return result;
  const exclude = excludeUserId ? Prisma.sql`AND s."userId" <> ${excludeUserId}` : Prisma.empty;
  const rows = await tx.$queryRaw<{ gameId: string; median: number; sample: bigint }[]>`
    WITH scopes AS (
      SELECT a."gameId", ${achievementScope} AS scope
      FROM "Achievement" a
      WHERE a."gameId" IN (${Prisma.join(gameIds)})
      GROUP BY a."gameId"
    )
    SELECT s."gameId",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.minutes) AS median,
           count(*) AS sample
    FROM scopes
    JOIN "GameCompletionSample" s USING ("gameId", scope)
    JOIN "UserGame" ug USING ("userId", "gameId")
    JOIN "Game" g ON g.id = s."gameId"
    JOIN "User" u ON u.id = s."userId"
    WHERE ug.completion >= 100 AND ug."lastUnlockedAt" = s."completedAt"
      AND NOT ug.hidden AND u."isPublic"
      AND NOT g."crossProgress"
      AND NOT EXISTS (
        SELECT 1 FROM "LinkedAccount" la
        WHERE la."userId" = s."userId" AND g.platform = 'STEAM'
          AND la.provider = 'STEAM' AND la."playtimeHidden"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "SteamIntegrityReview" r
        WHERE r."gameId" = s."gameId" AND r."userId" = s."userId"
          AND (r.status <> 'APPROVED' OR r."suspendedAt" IS NOT NULL OR r."resetAt" > s."observedAt"
            OR r.trust @> '{"signals":[{"kind":"other_platform","weight":3}]}')
      )
      ${exclude}
    GROUP BY s."gameId"
    HAVING count(*) >= ${minSample}`;
  for (const row of rows) {
    result.set(row.gameId, { median: Number(row.median), sample: Number(row.sample) });
  }
  return result;
}

/**
 * Rattrape les 100 % atteints avant la collecte des mesures. Le temps actuel vaut la mesure quand
 * le joueur n'a plus joué au-delà de quelques jours après son dernier succès ; sinon il compte
 * des heures postérieures et le relevé est écarté. Rejouable : une mesure existante est gardée.
 * Renvoie le nombre de mesures ajoutées.
 */
export async function backfillCompletionTimes(now = new Date()) {
  return db.$executeRaw`
    INSERT INTO "GameCompletionSample" ("userId", "gameId", scope, minutes, "completedAt", "observedAt")
    SELECT ug."userId", g.id, catalog.scope, ug."playtimeMinutes", ug."lastUnlockedAt", ${now}
    FROM "UserGame" ug
    JOIN "Game" g ON g.id = ug."gameId"
    CROSS JOIN LATERAL (
      SELECT ${achievementScope} AS scope, count(*) AS total
      FROM "Achievement" a WHERE a."gameId" = g.id
    ) catalog
    WHERE ug.completion >= 100 AND ug."playtimeMinutes" > 0
      AND ug."lastUnlockedAt" IS NOT NULL AND ug."lastPlayedAt" IS NOT NULL
      AND ug."lastPlayedAt" <= ug."lastUnlockedAt" + ${BACKFILL_GRACE}::interval
      AND catalog.total > 0 AND ug."unlockedCount" = catalog.total
      AND NOT ug.hidden AND NOT g."crossProgress"
      AND NOT EXISTS (
        SELECT 1 FROM "LinkedAccount" la
        WHERE la."userId" = ug."userId" AND g.platform = 'STEAM'
          AND la.provider = 'STEAM' AND la."playtimeHidden"
      )
    ON CONFLICT ("userId", "gameId", scope) DO NOTHING
  `;
}
