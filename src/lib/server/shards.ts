import type { ShardReason } from '#prisma';
import { capGains, completionShards, GAME_SHARD_CAP, shardsFor, STARTER_CAP } from '#lib/shards';
import { db } from './db';

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export interface Entry {
  reason: ShardReason;
  refId: string;
  gameId: string | null;
  shards: number;
}

/**
 * Écrit des mouvements d'éclats et met le solde à jour, dans la transaction donnée. Un mouvement
 * déjà écrit (même joueur, même raison, même référence) est ignoré : seul ce qui est vraiment
 * nouveau s'ajoute au solde. Renvoie les éclats gagnés.
 */
export async function addEntries(tx: Tx, userId: string, entries: Entry[]) {
  const kept = entries.filter((entry) => entry.shards > 0);
  if (!kept.length) return 0;
  const written = await tx.$queryRaw<{ delta: number }[]>`
    INSERT INTO "ShardEntry" ("id", "userId", "delta", "reason", "refId", "gameId")
    SELECT gen_random_uuid()::text, ${userId}, row.delta, row.reason::"ShardReason", row.ref, row.game
    FROM unnest(
      ${kept.map((entry) => entry.shards)}::int[],
      ${kept.map((entry) => entry.reason)}::text[],
      ${kept.map((entry) => entry.refId)}::text[],
      ${kept.map((entry) => entry.gameId)}::text[]
    ) AS row(delta, reason, ref, game)
    ON CONFLICT ("userId", "reason", "refId") DO NOTHING
    RETURNING delta`;
  const gained = written.reduce((sum, row) => sum + row.delta, 0);
  if (gained > 0) {
    await tx.user.update({ where: { id: userId }, data: { shards: { increment: gained } } });
  }
  return gained;
}

/**
 * Un temps de jeu Steam privé ne laisse rien vérifier : le joueur garde sa collection, mais ne
 * gagne ni éclats ni boosters tant qu'il ne le rend pas public (comme pour le classement).
 */
export async function playtimeHidden(tx: Tx | typeof db, userId: string) {
  const account = await tx.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider: 'STEAM' } },
    select: { playtimeHidden: true },
  });
  return Boolean(account?.playtimeHidden);
}

/** Les éclats déjà gagnés sur un jeu par ses succès, pour le plafond par jeu. */
async function earnedOnGame(tx: Tx, userId: string, gameId: string) {
  const [row] = await tx.$queryRaw<{ total: number }[]>`
    SELECT coalesce(sum(delta), 0)::int AS total FROM "ShardEntry"
    WHERE "userId" = ${userId} AND "gameId" = ${gameId} AND reason = 'ACHIEVEMENT'`;
  return row?.total ?? 0;
}

/**
 * Crédite des succès tout juste enregistrés. Seuls comptent ceux débloqués depuis
 * `User.shardsFrom` : l'historique d'avant passe par le capital de départ, plafonné. Les plus
 * rares passent en premier sous le plafond du jeu.
 */
export async function creditUnlocks(
  tx: Tx,
  userId: string,
  gameId: string,
  unlocks: { achievementId: string; unlockedAt: Date }[],
  shardsFrom: Date,
) {
  const recent = unlocks.filter((unlock) => unlock.unlockedAt >= shardsFrom);
  if (!recent.length) return 0;
  const rarities = await tx.achievement.findMany({
    where: { id: { in: recent.map((unlock) => unlock.achievementId) } },
    select: { id: true, globalRarity: true },
  });
  const gains = rarities
    .map((row) => ({
      reason: 'ACHIEVEMENT' as const,
      refId: row.id,
      gameId,
      shards: shardsFor(row.globalRarity),
    }))
    .toSorted((a, b) => b.shards - a.shards);
  return addEntries(tx, userId, capGains(gains, await earnedOnGame(tx, userId, gameId)));
}

/**
 * Le bonus d'un jeu fini depuis `User.shardsFrom`, une seule fois par jeu : un 100 % perdu
 * (une extension ajoute des succès) puis retrouvé ne paie pas deux fois.
 */
export async function creditCompletion(
  tx: Tx,
  userId: string,
  gameId: string,
  finishedAt: Date | null,
  shardsFrom: Date,
) {
  if (!finishedAt || finishedAt < shardsFrom) return 0;
  const game = await tx.game.findUnique({ where: { id: gameId }, select: { tier: true } });
  return addEntries(tx, userId, [
    { reason: 'COMPLETION', refId: gameId, gameId, shards: completionShards(game?.tier) },
  ]);
}

/**
 * Ce que l'historique d'avant `User.shardsFrom` vaudrait au barème : chaque succès selon sa
 * rareté, plafonné par jeu, plus le bonus des jeux finis à cette date.
 */
async function historyValue(userId: string, shardsFrom: Date) {
  const games = await db.$queryRaw<{ gameId: string; rarities: (number | null)[] }[]>`
    SELECT a."gameId", array_agg(a."globalRarity") AS rarities
    FROM "UserAchievement" ua
    JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE ua."userId" = ${userId} AND ua."unlockedAt" < ${shardsFrom}
    GROUP BY a."gameId"`;
  const finished = await db.$queryRaw<{ tier: number | null }[]>`
    SELECT g.tier FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
    WHERE ug."userId" = ${userId} AND ug.completion >= 100 AND ug."lastUnlockedAt" < ${shardsFrom}`;
  const achievements = games.reduce(
    (sum, game) =>
      sum +
      Math.min(
        GAME_SHARD_CAP,
        game.rarities.reduce<number>((s, r) => s + shardsFor(r), 0),
      ),
    0,
  );
  return achievements + finished.reduce((sum, game) => sum + completionShards(game.tier), 0);
}

/**
 * Verse le capital de départ aux joueurs qui ont un historique mais pas encore de capital : ceux
 * inscrits avant la mise en ligne des éclats. Rejouable : un joueur servi sort de la liste.
 * Renvoie le nombre de joueurs traités, pour l'entretien par lots.
 */
export async function grantMissingStarters(limit: number) {
  const users = await db.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM "User" u
    WHERE NOT EXISTS (
        SELECT 1 FROM "ShardEntry" e WHERE e."userId" = u.id AND e.reason = 'STARTER'
      )
      AND EXISTS (
        SELECT 1 FROM "UserAchievement" ua
        WHERE ua."userId" = u.id AND ua."unlockedAt" < u."shardsFrom"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "LinkedAccount" la
        WHERE la."userId" = u.id AND la.provider = 'STEAM' AND la."playtimeHidden"
      )
    LIMIT ${limit}`;
  for (const user of users) await grantStarter(user.id);
  return users.length;
}

/**
 * Verse ou complète le capital de départ, jusqu'à `STARTER_CAP`. On l'appelle après le premier
 * import de chaque compte lié : un compte ajouté plus tard complète le capital, sans le dépasser.
 * Chaque complément est enregistré sous son nouveau total, donc un appel rejoué ne paie rien.
 */
export async function grantStarter(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { shardsFrom: true } });
  // Le capital attend que le temps de jeu soit public : la tournée d'entretien le versera alors.
  if (!user || (await playtimeHidden(db, userId))) return 0;
  const target = Math.min(STARTER_CAP, await historyValue(userId, user.shardsFrom));
  return db.$transaction(async (tx) => {
    // Sérialise deux comptes qui finissent leur premier import en même temps.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`starter:${userId}`}, 0))::text`;
    const [row] = await tx.$queryRaw<{ total: number }[]>`
      SELECT coalesce(sum(delta), 0)::int AS total FROM "ShardEntry"
      WHERE "userId" = ${userId} AND reason = 'STARTER'`;
    const missing = target - (row?.total ?? 0);
    if (missing <= 0) return 0;
    return addEntries(tx, userId, [
      { reason: 'STARTER', refId: `starter:${target}`, gameId: null, shards: missing },
    ]);
  });
}
