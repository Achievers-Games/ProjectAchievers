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
  /** Rareté de la carte, selon le nombre de plateformes à 100 %. */
  tier?: number;
}

/** Une carte obtenue, affichée dans le fil en direct. */
export interface CardDrop {
  user: { handle: string; displayName: string; avatarUrl: string | null };
  game: { name: string; slug: string; headerUrl: string | null };
  unlockedAt: Date | string;
}

/** Une plateforme à 100 % donne l'Or, chaque plateforme de plus fait monter la carte. */
export const TIER_LABELS: Record<number, string> = {
  1: 'Or',
  2: 'Platine',
  3: 'Prismatique',
  4: 'Légendaire',
};

export const tierFor = (platforms: number) => Math.min(platforms, 4);

export interface NextTier {
  tier: number;
  platform: Platform;
  completion: number;
}

/**
 * Avancement vers le niveau suivant : la version commencée la plus avancée sur une plateforme
 * pas encore finie. Rien tant qu'aucune carte n'est obtenue, ou sans autre version commencée.
 */
export function nextTier(versions: { platform: Platform; completion: number }[]): NextTier | null {
  const finished = new Set(versions.filter((v) => v.completion >= 100).map((v) => v.platform));
  if (finished.size === 0) return null;

  const started = versions
    .filter((v) => !finished.has(v.platform) && v.completion > 0)
    .toSorted((a, b) => b.completion - a.completion)[0];
  return started
    ? {
        tier: tierFor(finished.size + 1),
        platform: started.platform,
        completion: started.completion,
      }
    : null;
}

/** Paliers avant le 100 % : la carte s'éclaire à mesure que le joueur avance. */
export const stepOf = (completion: number) => {
  if (completion >= 100) return 0;
  if (completion >= 75) return 3;
  if (completion >= 50) return 2;
  return completion >= 25 ? 1 : 0;
};

/** Seul le 100 % réel donne une carte : un platine ne couvre souvent pas les trophées de DLC. */
export const isComplete = (progress: CardProgress | null | undefined) =>
  Boolean(progress && progress.completion >= 100);
