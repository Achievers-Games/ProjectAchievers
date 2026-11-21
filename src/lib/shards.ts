/**
 * Les éclats, la monnaie des boosters de cartes. Un succès rapporte selon sa rareté : la monnaie
 * récompense la difficulté, pas le volume. Valeurs de départ, à calibrer sur l'activité réelle.
 */

/** Éclats d'un succès selon la part de joueurs qui l'ont, du plus courant au plus rare. */
export const SHARD_STEPS = [
  { from: 50, shards: 1 },
  { from: 20, shards: 2 },
  { from: 10, shards: 4 },
  { from: 5, shards: 8 },
  { from: 1, shards: 15 },
  { from: 0, shards: 30 },
] as const;

/** Sans taux exploitable, un succès vaut un succès plutôt courant. */
export const UNKNOWN_RARITY_SHARDS = 2;

/** Au-delà, les succès d'un jeu ne rapportent plus : un jeu à 1 000 succès faciles reste un jeu. */
export const GAME_SHARD_CAP = 400;

/** Bonus d'un jeu fini, selon le niveau de sa carte : du Bronze (1) au Légendaire (6). */
export const COMPLETION_SHARDS = [20, 40, 70, 110, 160, 220] as const;

/** Plafond du capital de départ, tiré de l'historique : 30 boosters. */
export const STARTER_CAP = 750;

/** Les éclats d'un succès. `rarity` est la part de joueurs en %, comme `Achievement.globalRarity`. */
export function shardsFor(rarity: number | null | undefined) {
  if (rarity == null || !(rarity > 0) || rarity > 100) return UNKNOWN_RARITY_SHARDS;
  return SHARD_STEPS.find((step) => rarity >= step.from)!.shards;
}

/** Le bonus d'un jeu fini ; sans niveau encore calculé, celui du Bronze. */
export function completionShards(tier: number | null | undefined) {
  const index = Math.min(Math.max((tier ?? 1) - 1, 0), COMPLETION_SHARDS.length - 1);
  return COMPLETION_SHARDS[index]!;
}

/**
 * Applique le plafond d'un jeu à une liste de gains, dans l'ordre : chaque gain prend ce qui reste
 * sous le plafond, et un gain qui ne rapporte plus rien disparaît.
 */
export function capGains<T extends { shards: number }>(gains: T[], already: number) {
  let room = Math.max(GAME_SHARD_CAP - already, 0);
  const kept: T[] = [];
  for (const gain of gains) {
    if (room <= 0) break;
    const shards = Math.min(gain.shards, room);
    room -= shards;
    kept.push({ ...gain, shards });
  }
  return kept;
}
