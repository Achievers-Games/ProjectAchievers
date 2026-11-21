import type { ShardReason } from '#prisma';
import { capGains, completionShards, GAME_SHARD_CAP, shardsFor, STARTER_CAP } from '#lib/shards';
import { logger } from '#lib/logger';
import { db } from './db';
import { cardsOpenedAt, shardsStart } from './cards-launch';

const log = logger('Éclats');

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

/** La référence d'une reprise : la raison et la référence du crédit repris. */
const revokedRef = (reason: 'ACHIEVEMENT' | 'COMPLETION', refId: string) => `${reason}:${refId}`;

/**
 * Reprend les éclats de succès retirés au joueur (triche avérée, progression remise à zéro), et
 * le bonus du jeu, qui n'est plus fini. Le crédit d'origine reste : le même succès retrouvé ne
 * paie pas une seconde fois, il annule la reprise. Le solde peut passer sous zéro si les éclats
 * sont déjà dépensés : les boosters payants attendent alors qu'il remonte.
 */
export async function revokeShards(
  tx: Tx,
  userId: string,
  gameId: string,
  achievementIds: string[],
) {
  if (!achievementIds.length) return 0;
  const written = await tx.$queryRaw<{ delta: number }[]>`
    INSERT INTO "ShardEntry" ("id", "userId", "delta", "reason", "refId", "gameId")
    SELECT gen_random_uuid()::text, e."userId", -e.delta, 'REVOKED', e.reason::text || ':' || e."refId", e."gameId"
    FROM "ShardEntry" e
    WHERE e."userId" = ${userId} AND e."gameId" = ${gameId} AND e.delta > 0
      AND (e.reason = 'COMPLETION'
        OR (e.reason = 'ACHIEVEMENT' AND e."refId" = ANY(${achievementIds}::text[])))
    ON CONFLICT ("userId", "reason", "refId") DO NOTHING
    RETURNING delta`;
  const taken = -written.reduce((sum, row) => sum + row.delta, 0);
  if (taken > 0) {
    await tx.user.update({ where: { id: userId }, data: { shards: { decrement: taken } } });
  }
  return taken;
}

/** Annule les reprises de ces crédits : le joueur a retrouvé ce qui lui avait été retiré. */
async function restoreShards(tx: Tx, userId: string, refs: string[]) {
  if (!refs.length) return 0;
  const removed = await tx.$queryRaw<{ delta: number }[]>`
    DELETE FROM "ShardEntry"
    WHERE "userId" = ${userId} AND reason = 'REVOKED' AND "refId" = ANY(${refs}::text[])
    RETURNING delta`;
  const back = -removed.reduce((sum, row) => sum + row.delta, 0);
  if (back > 0) {
    await tx.user.update({ where: { id: userId }, data: { shards: { increment: back } } });
  }
  return back;
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
  const restored = await restoreShards(
    tx,
    userId,
    unlocks.map((unlock) => revokedRef('ACHIEVEMENT', unlock.achievementId)),
  );
  const recent = unlocks.filter((unlock) => unlock.unlockedAt >= shardsFrom);
  if (!recent.length) return restored;
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
  const earned = await earnedOnGame(tx, userId, gameId);
  return restored + (await addEntries(tx, userId, capGains(gains, earned)));
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
  const restored = await restoreShards(tx, userId, [revokedRef('COMPLETION', gameId)]);
  if (restored || !finishedAt || finishedAt < shardsFrom) return restored;
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
      -- Vu en direct après la mise en ligne, puis daté plus tôt par Steam : déjà payé à l'unité.
      AND NOT EXISTS (
        SELECT 1 FROM "ShardEntry" e
        WHERE e."userId" = ${userId} AND e.reason = 'ACHIEVEMENT' AND e."refId" = ua."achievementId"
      )
    GROUP BY a."gameId"`;
  const finished = await db.$queryRaw<{ tier: number | null }[]>`
    SELECT g.tier FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
    WHERE ug."userId" = ${userId} AND ug.completion >= 100 AND ug."lastUnlockedAt" < ${shardsFrom}
      AND NOT EXISTS (
        SELECT 1 FROM "ShardEntry" e
        WHERE e."userId" = ${userId} AND e.reason = 'COMPLETION' AND e."refId" = ug."gameId"
      )`;
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
  const opening = cardsOpenedAt();
  if (!opening) return 0;
  const users = await db.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM "User" u
    WHERE NOT EXISTS (
        SELECT 1 FROM "ShardEntry" e WHERE e."userId" = u.id AND e.reason = 'STARTER'
      )
      AND EXISTS (
        SELECT 1 FROM "UserAchievement" ua
        WHERE ua."userId" = u.id AND ua."unlockedAt" < GREATEST(u."shardsFrom", ${opening})
          -- Comme dans historyValue : un succès déjà payé à l'unité ne fait pas un historique.
          AND NOT EXISTS (
            SELECT 1 FROM "ShardEntry" e
            WHERE e."userId" = u.id AND e.reason = 'ACHIEVEMENT' AND e."refId" = ua."achievementId"
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "LinkedAccount" la
        WHERE la."userId" = u.id AND la.provider = 'STEAM' AND la."playtimeHidden"
      )
    ORDER BY u.id
    LIMIT ${limit}`;
  // Un joueur en échec ne prive pas les suivants : il sera retenté à la tournée suivante.
  for (const user of users) {
    await grantStarter(user.id).catch((cause: unknown) =>
      log.error("Capital d'éclats", { userId: user.id, cause }),
    );
  }
  return users.length;
}

/**
 * Verse ou complète le capital de départ, jusqu'à `STARTER_CAP`. On l'appelle après le premier
 * import de chaque compte lié : un compte ajouté plus tard complète le capital, sans le dépasser.
 * Chaque complément est enregistré sous son nouveau total, donc un appel rejoué ne paie rien.
 */
export async function grantStarter(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { shardsFrom: true } });
  const from = user && shardsStart(user.shardsFrom);
  // Le capital attend l'ouverture des éclats et un temps de jeu public : la tournée d'entretien
  // le versera alors.
  if (!from || (await playtimeHidden(db, userId))) return 0;
  const target = Math.min(STARTER_CAP, await historyValue(userId, from));
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

/**
 * Rattrape les éclats d'un joueur dont le temps de jeu Steam redevient public : les succès
 * obtenus pendant qu'il était privé, ceux retrouvés pendant ce temps après une reprise, et les
 * jeux finis entre-temps paient comme s'ils venaient d'être lus. Rejouable : rien ne paie deux fois.
 */
export async function catchUpShards(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { shardsFrom: true } });
  const from = user && shardsStart(user.shardsFrom);
  if (!from || (await playtimeHidden(db, userId))) return 0;
  const unlocks = await db.$queryRaw<{ gameId: string; achievementId: string; unlockedAt: Date }[]>`
    SELECT a."gameId", ua."achievementId", ua."unlockedAt"
    FROM "UserAchievement" ua
    JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE ua."userId" = ${userId}
      AND (
        (ua."unlockedAt" >= ${from} AND NOT EXISTS (
          SELECT 1 FROM "ShardEntry" e
          WHERE e."userId" = ${userId} AND e.reason = 'ACHIEVEMENT' AND e."refId" = ua."achievementId"
        ))
        OR EXISTS (
          SELECT 1 FROM "ShardEntry" e
          WHERE e."userId" = ${userId} AND e.reason = 'REVOKED'
            AND e."refId" = 'ACHIEVEMENT:' || ua."achievementId"
        )
      )`;
  const [games, entries] = await Promise.all([
    db.userGame.findMany({
      where: { userId, completion: { gte: 100 } },
      select: { gameId: true, lastUnlockedAt: true },
    }),
    db.shardEntry.findMany({
      where: { userId, reason: { in: ['COMPLETION', 'REVOKED'] } },
      select: { reason: true, refId: true },
    }),
  ]);
  const settled = new Set(
    entries.filter((entry) => entry.reason === 'COMPLETION').map((entry) => entry.refId),
  );
  for (const entry of entries) {
    if (entry.reason === 'REVOKED') settled.delete(entry.refId.replace(/^COMPLETION:/, ''));
  }
  const finished = games.filter((game) => !settled.has(game.gameId));
  let gained = 0;
  for (const [gameId, rows] of Map.groupBy(unlocks, (unlock) => unlock.gameId)) {
    gained += await db.$transaction((tx) => creditUnlocks(tx, userId, gameId, rows, from));
  }
  for (const game of finished) {
    gained += await db.$transaction((tx) =>
      creditCompletion(tx, userId, game.gameId, game.lastUnlockedAt, from),
    );
  }
  return gained;
}
