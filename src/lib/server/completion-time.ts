import { Prisma } from '#prisma';
import { db } from './db';

/** Sous ce nombre de joueurs, une médiane trahirait le temps de jeu d'un joueur précis. */
export const COMPLETION_TIME_MIN_SAMPLE = 5;

/**
 * Le temps médian qu'il a fallu aux joueurs publics pour finir chaque jeu à 100 %, en minutes.
 * Jamais le temps d'un joueur seul : un jeu fini par moins de 5 joueurs n'a pas de médiane.
 */
export async function completionTimes(gameIds: string[]) {
  const result = new Map<string, { median: number; sample: number }>();
  if (gameIds.length === 0) return result;
  const rows = await db.$queryRaw<{ gameId: string; median: number; sample: bigint }[]>`
    SELECT ug."gameId",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ug."playtimeMinutes") AS median,
           count(*) AS sample
    FROM "UserGame" ug
    JOIN "User" u ON u.id = ug."userId"
    WHERE ug."gameId" IN (${Prisma.join(gameIds)})
      AND ug.completion >= 100 AND ug."playtimeMinutes" > 0
      AND NOT ug.hidden AND u."isPublic"
    GROUP BY ug."gameId"
    HAVING count(*) >= ${COMPLETION_TIME_MIN_SAMPLE}`;
  for (const row of rows) {
    result.set(row.gameId, { median: Number(row.median), sample: Number(row.sample) });
  }
  return result;
}
