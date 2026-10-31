import type { Platform } from '@prisma/client';
import { nextTier, tierFor, type NextTier } from '$lib/collection';

interface LibraryRow {
  unlockedCount: number;
  completion: number;
  platinum: boolean;
  lastUnlockedAt: Date | null;
  game: {
    id: string;
    name: string;
    slug: string;
    platform: Platform;
    coverUrl: string | null;
    headerUrl: string | null;
    totalAchievements: number;
    familyKey: string | null;
  };
}

export interface LibraryCard {
  id: string;
  name: string;
  slug: string;
  platform: Platform;
  coverUrl: string | null;
  headerUrl: string | null;
  totalAchievements: number;
  progress: { unlockedCount: number; completion: number; platinum: boolean };
  lastUnlockedAt: Date | null;
  versions: { platform: Platform; slug: string; completion: number }[];
  tier: number;
  next: NextTier | null;
}

/**
 * Réunit les versions d'un jeu en une seule carte, celle de la version la plus avancée.
 * Finir une seule version suffit à obtenir la carte ; chaque autre plateforme la fait monter.
 */
export function groupLibrary(rows: LibraryRow[]): LibraryCard[] {
  const families = Map.groupBy(rows, (row) => row.game.familyKey ?? row.game.id);

  return [...families.values()].map((family) => {
    const versions = family.toSorted((a, b) => b.completion - a.completion);
    const best = versions[0] as LibraryRow;
    const finished = new Set(
      versions.filter((v) => v.completion >= 100).map((v) => v.game.platform),
    );
    const summary = versions.map((v) => ({
      platform: v.game.platform,
      slug: v.game.slug,
      completion: v.completion,
    }));
    return {
      id: best.game.id,
      name: best.game.name,
      slug: best.game.slug,
      platform: best.game.platform,
      coverUrl: best.game.coverUrl,
      headerUrl: best.game.headerUrl,
      totalAchievements: best.game.totalAchievements,
      progress: {
        unlockedCount: best.unlockedCount,
        completion: best.completion,
        platinum: best.platinum,
      },
      lastUnlockedAt: best.lastUnlockedAt,
      versions: summary,
      tier: tierFor(finished.size),
      next: nextTier(summary),
    };
  });
}
