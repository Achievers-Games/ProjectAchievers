/**
 * Qui a quoi, succès par succès. Pur : la page de jeu et ses tests l'utilisent sans base.
 *
 * Un succès masqué (caché et pas encore révélé) reste `neither` même si l'autre l'a déjà
 * débloqué : son état ne doit pas fuiter avant « Révéler les succès cachés ».
 */
export type CompareBucket = 'common' | 'mine' | 'theirs' | 'neither';

export interface CompareCounts {
  common: number;
  mine: number;
  theirs: number;
  neither: number;
}

export interface ComparableAchievement {
  id: string;
  masked: boolean;
  unlockedAt: Date | null;
}

export function compareBucket(
  achievement: ComparableAchievement,
  theirUnlocks: ReadonlySet<string>,
): CompareBucket {
  if (achievement.masked) return 'neither';
  const mine = achievement.unlockedAt !== null;
  const theirs = theirUnlocks.has(achievement.id);
  if (mine && theirs) return 'common';
  if (mine) return 'mine';
  if (theirs) return 'theirs';
  return 'neither';
}

/**
 * `visible` ne contient que les succès dont l'état de l'autre peut être montré : jamais un
 * masqué, même débloqué par lui.
 */
export function compareAchievements(
  achievements: readonly ComparableAchievement[],
  theirUnlocks: Iterable<string>,
): { visible: string[]; counts: CompareCounts } {
  const theirs = new Set(theirUnlocks);
  const visible = achievements
    .filter((achievement) => !achievement.masked && theirs.has(achievement.id))
    .map((achievement) => achievement.id);

  const counts: CompareCounts = { common: 0, mine: 0, theirs: 0, neither: 0 };
  for (const achievement of achievements) counts[compareBucket(achievement, theirs)]++;
  return { visible, counts };
}
