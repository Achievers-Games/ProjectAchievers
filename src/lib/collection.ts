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
    adultOnly?: boolean;
    familyKey?: string | null;
  };
  progress: CardProgress;
  unlockedAt: Date | null;
  /** Le même jeu est aussi à 100 % sur une autre plateforme. */
  double?: boolean;
}

/** Une carte obtenue, affichée dans le fil en direct. */
export interface CardDrop {
  user: { handle: string; displayName: string; avatarUrl: string | null };
  game: { name: string; slug: string; headerUrl: string | null };
  unlockedAt: Date | string;
}

/** Seul le 100 % réel donne une carte : un platine ne couvre souvent pas les trophées de DLC. */
export const isComplete = (progress: CardProgress | null | undefined) =>
  Boolean(progress && progress.completion >= 100);
