import type { Platform } from '#prisma';
import { copiesFor, copyKey, nextCopy, type NextCopy } from '#lib/collection';

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
    console?: string | null;
    coverUrl: string | null;
    headerUrl: string | null;
    totalAchievements: number;
    familyKey: string | null;
    tier?: number | null;
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
  versions: {
    platform: Platform;
    console: string | null;
    name: string;
    slug: string;
    completion: number;
  }[];
  tier: number;
  /** Le niveau de la carte à gagner en finissant la version la plus avancée. */
  target: number;
  copies: number;
  next: NextCopy | null;
}

/**
 * Réunit les versions d'un jeu en une seule carte, celle de la version la plus avancée.
 * Finir une seule version suffit à obtenir la carte, au niveau de la version finie la plus dure ;
 * chaque autre plateforme ou console lui ajoute un exemplaire.
 */
export function groupLibrary(rows: LibraryRow[]): LibraryCard[] {
  const families = Map.groupBy(rows, (row) => row.game.familyKey ?? row.game.id);

  return [...families.values()].map((family) => {
    const versions = family.toSorted((a, b) => b.completion - a.completion);
    const best = versions[0] as LibraryRow;
    const done = versions.filter((v) => v.completion >= 100);
    const finished = new Set(done.map((v) => copyKey(v.game)));
    const summary = versions.map((v) => ({
      platform: v.game.platform,
      console: v.game.console ?? null,
      name: v.game.name,
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
      tier: Math.max(0, ...done.map((v) => v.game.tier ?? 1)),
      target: best.game.tier ?? 1,
      copies: copiesFor(finished.size),
      next: nextCopy(summary),
    };
  });
}
