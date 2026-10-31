export interface Season {
  startsAt: Date;
  endsAt: Date;
  /** Succès à achever tous ensemble. */
  goal: number;
  tiers: readonly [number, number, number];
  /** Limite les outils qui débloquent tous les succès d'un coup. */
  dailyCap: number;
  /** Bonus d'un jeu terminé à 100 % pendant la saison. */
  completionBonus: number;
}

export const SEASON: Season = {
  startsAt: new Date('2026-12-01T00:00:00Z'),
  endsAt: new Date('2026-12-29T00:00:00Z'),
  goal: 5_000,
  tiers: [100, 500, 2_000],
  dailyCap: 300,
  completionBonus: 500,
};

export type SeasonState = 'soon' | 'running' | 'ended';

export function seasonState(season: Season, now = Date.now()): SeasonState {
  if (now < season.startsAt.getTime()) return 'soon';
  return now < season.endsAt.getTime() ? 'running' : 'ended';
}
