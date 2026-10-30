import type { Platform } from '@prisma/client';

export interface CardProgress {
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
  progress: CardProgress;
}

/** Un jeu terminé devient une carte : 100 % des succès, ou le trophée platine PlayStation. */
export const isComplete = (progress: CardProgress | null | undefined) =>
  Boolean(progress && (progress.platinum || progress.completion >= 100));
