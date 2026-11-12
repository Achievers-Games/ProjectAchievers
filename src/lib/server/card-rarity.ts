import { Prisma } from '#prisma';
import { RARITY_STEPS, SIZE_STEPS } from '#lib/collection';
import { db } from './db';

/** Même verrou que la création du catalogue : rattachements et recalculs restent cohérents. */
export const lockCardCatalog = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('game-catalog', 0))::text`;

/**
 * Une moyenne par plateforme, puis une moyenne entre plateformes : trois listes PSN ne
 * pèsent pas trois fois Steam. Les listes sans taux n'inventent jamais un taux de zéro.
 * Le SQL ne remonte aucun catalogue de succès dans la mémoire du serveur.
 */
export function sharedTierUpdate(families?: string[]) {
  const rarityCases = Prisma.join(
    RARITY_STEPS.map(
      (threshold, index) => Prisma.sql`WHEN rarity >= ${threshold}::numeric THEN ${index + 1}`,
    ),
    ' ',
  );
  const sizeCases = Prisma.join(
    SIZE_STEPS.map((threshold, index) => Prisma.sql`WHEN size < ${threshold} THEN ${index + 1}`),
    ' ',
  );
  return Prisma.sql`
    WITH versions AS (
      SELECT COALESCE(g."familyKey", g.id) AS family, g.platform,
        (min(a."globalRarity") FILTER (WHERE a."globalRarity" > 0 AND a."globalRarity" <= 100))::numeric AS rarity,
        count(a.id) AS size
      FROM "Game" g LEFT JOIN "Achievement" a ON a."gameId" = g.id
      ${families ? Prisma.sql`WHERE COALESCE(g."familyKey", g.id) = ANY(${families}::text[])` : Prisma.empty}
      GROUP BY g.id
    ), platforms AS (
      SELECT family, platform, avg(rarity) AS rarity, avg(size) FILTER (WHERE size > 0) AS size
      FROM versions GROUP BY family, platform
    ), averages AS (
      SELECT family, avg(rarity) AS rarity, COALESCE(avg(size), 0) AS size
      FROM platforms GROUP BY family
    ), tiers AS (
      SELECT family, CASE WHEN rarity IS NOT NULL THEN CASE ${rarityCases} ELSE 6 END
        ELSE CASE ${sizeCases} ELSE 6 END END AS tier
      FROM averages
    )
    UPDATE "Game" g SET tier = tiers.tier
    FROM tiers
    WHERE COALESCE(g."familyKey", g.id) = tiers.family AND g.tier IS DISTINCT FROM tiers.tier`;
}

/** À appeler sous `lockCardCatalog`, dans la transaction qui modifie la famille. */
export async function updateFamilyTiers(tx: Prisma.TransactionClient, families: string[]) {
  const keys = [...new Set(families)];
  if (keys.length) await tx.$executeRaw(sharedTierUpdate(keys));
}

export async function refreshSharedTier(gameId: string) {
  await db.$transaction(
    async (tx) => {
      await lockCardCatalog(tx);
      const game = await tx.game.findUnique({
        where: { id: gameId },
        select: { id: true, familyKey: true },
      });
      if (game) await updateFamilyTiers(tx, [game.familyKey ?? game.id]);
    },
    { timeout: 30_000 },
  );
}

/** Les anciennes et nouvelles familles sont recalculées, y compris après une séparation. */
export async function moveGameFamilies(
  ids: string[],
  data: { familyKey: string; familyLocked?: boolean; familyMatched?: boolean },
) {
  await db.$transaction(
    async (tx) => {
      await lockCardCatalog(tx);
      const before = await tx.game.findMany({
        where: { id: { in: ids } },
        select: { id: true, familyKey: true },
      });
      await tx.game.updateMany({ where: { id: { in: ids } }, data });
      await updateFamilyTiers(tx, [
        ...before.map((game) => game.familyKey ?? game.id),
        data.familyKey,
      ]);
    },
    { timeout: 30_000 },
  );
}
