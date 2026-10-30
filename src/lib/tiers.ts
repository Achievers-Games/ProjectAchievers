import type { Platform } from '@prisma/client';

/** Rareté d'une carte : le 100 % est en or, le trophée platine PlayStation au-dessus. */
export type Tier = 'complet' | 'platine';

export interface TierProgress {
  unlockedCount: number;
  completion: number;
  platinum: boolean;
}

export interface Reward {
  game: {
    name: string;
    slug: string;
    platform: Platform;
    headerUrl: string | null;
    totalAchievements: number;
  };
  progress: TierProgress;
}

export function tierOf(progress: TierProgress | null | undefined): Tier | null {
  if (!progress) return null;
  if (progress.platinum) return 'platine';
  return progress.completion >= 100 ? 'complet' : null;
}

export const TIER_LABELS: Record<Tier, string> = {
  complet: '100 %',
  platine: 'Platine',
};
