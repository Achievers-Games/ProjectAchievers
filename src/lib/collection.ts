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
  /** Niveau de la carte, selon la difficulté du jeu. */
  tier?: number;
  /** Nombre de plateformes terminées : ×2, ×3 ou ×4. */
  copies?: number;
}

/** Une carte obtenue, affichée dans le fil en direct. */
export interface CardDrop {
  user: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    avatarMotionUrl?: string | null;
    frame?: string | null;
    frameMotionUrl?: string | null;
  };
  game: { name: string; slug: string; headerUrl: string | null };
  unlockedAt: Date | string;
}

export const TIERS = [1, 2, 3, 4, 5, 6];
/** Les effets holographiques commencent à l'Or. */
export const HOLO_TIER = 3;

/** Part de joueurs ayant le succès le plus rare, du Bronze au Prismatique ; en dessous, Légendaire. */
export const RARITY_STEPS = [10, 4, 2, 1, 0.3];
/** Sans rareté publiée (Xbox, Battle.net), le nombre de succès mesure l'effort demandé. */
const SIZE_STEPS = [20, 40, 70, 120, 300];

/** Le niveau d'un jeu vient de sa difficulté, jamais du nombre de plateformes où il existe. */
export function difficultyTier(rarest: number | null, achievements: number) {
  const step =
    rarest === null
      ? SIZE_STEPS.findIndex((size) => achievements < size)
      : RARITY_STEPS.findIndex((rarity) => rarest >= rarity);
  return step < 0 ? TIERS.length : step + 1;
}

/** Terminer une autre version ne change pas le niveau : la carte gagne un exemplaire de plus. */
export const copiesFor = (platforms: number) => Math.min(platforms, 4);

export interface NextCopy {
  copies: number;
  platform: Platform;
  completion: number;
}

/**
 * Avancement vers l'exemplaire suivant : la version commencée la plus avancée sur une plateforme
 * pas encore finie. Rien tant qu'aucune carte n'est obtenue, ou sans autre version commencée.
 */
export function nextCopy(versions: { platform: Platform; completion: number }[]): NextCopy | null {
  const finished = new Set(versions.filter((v) => v.completion >= 100).map((v) => v.platform));
  if (finished.size === 0) return null;

  const started = versions
    .filter((v) => !finished.has(v.platform) && v.completion > 0)
    .toSorted((a, b) => b.completion - a.completion)[0];
  return started
    ? {
        copies: copiesFor(finished.size + 1),
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
