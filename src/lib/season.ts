export interface Season {
  startsAt: Date;
  endsAt: Date;
  /** Succès à achever tous ensemble. */
  goal: number;
  tiers: readonly [number, number, number];
  /** Écartent les rafales d'un même jeu : outils, synchronisations ou jeux à succès automatiques. */
  burstPerSecond: number;
  burstPerMinute: number;
  /** Bonus d'un jeu terminé à 100 % pendant la saison. */
  completionBonus: number;
}

/** Points d'un succès selon la part des joueurs qui l'ont obtenu. */
export const RARITY_POINTS = { common: 5, uncommon: 10, rare: 25, epic: 50 } as const;

export const SEASON: Season = {
  startsAt: new Date('2026-12-01T00:00:00Z'),
  endsAt: new Date('2026-12-29T00:00:00Z'),
  goal: 5_000,
  tiers: [100, 500, 2_000],
  burstPerSecond: 20,
  burstPerMinute: 60,
  completionBonus: 500,
};

export type SeasonState = 'soon' | 'running' | 'ended';

export function seasonState(season: Season, now = Date.now()): SeasonState {
  if (now < season.startsAt.getTime()) return 'soon';
  return now < season.endsAt.getTime() ? 'running' : 'ended';
}
