import { db } from '../db';
import { isBlocked, personSelect } from '../social/shared';

/**
 * La comparaison porte sur une version précise du jeu : les identifiants de succès changent
 * d'une version à l'autre, donc seule la même ligne `Game` se compare vraiment.
 */
export async function compareGame({
  viewerId,
  gameId,
  handle,
}: {
  viewerId: string;
  gameId: string;
  handle: string;
}) {
  const normalized = handle.trim().toLowerCase();
  if (!normalized) return null;

  // Un profil privé ne se trouve pas, et un blocage ne se devine pas : même réponse muette.
  const user = await db.user.findFirst({
    where: { handle: normalized, isPublic: true },
    select: personSelect,
  });
  if (!user || user.id === viewerId) return null;
  if (await isBlocked(viewerId, user.id)) return null;

  const progress = await db.userGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId } },
    select: { unlockedCount: true, totalCount: true, completion: true, hidden: true },
  });
  // Un jeu caché vaut « ne possède pas » : sa progression reste privée.
  if (!progress || progress.hidden) return { user, progress: null, unlocked: [] as string[] };

  const unlocks = await db.userAchievement.findMany({
    where: { userId: user.id, achievement: { gameId } },
    select: { achievementId: true },
  });
  return {
    user,
    progress: {
      unlockedCount: progress.unlockedCount,
      totalCount: progress.totalCount,
      completion: progress.completion,
    },
    unlocked: unlocks.map((row) => row.achievementId),
  };
}
