import { db } from '../db';
import { isBlocked, personSelect } from '../social/shared';

/**
 * Ce qu'un joueur a fait d'un jeu, pour le montrer sur la fiche du jeu : ses succès, sa
 * progression, son temps de jeu. Un profil privé, un blocage ou un jeu caché rendent `null`,
 * sans dire lequel ; chacun peut toujours regarder sa propre fiche.
 */
export async function gamePlayer({
  viewerId,
  gameId,
  handle,
}: {
  viewerId: string | null;
  gameId: string;
  handle: string;
}) {
  const user = await db.user.findUnique({
    where: { handle: handle.trim().toLowerCase() },
    select: {
      ...personSelect,
      isPublic: true,
      accounts: { where: { provider: 'STEAM' }, select: { playtimeHidden: true } },
    },
  });
  if (!user) return null;
  const self = user.id === viewerId;
  if (!self && !user.isPublic) return null;
  if (!self && viewerId && (await isBlocked(viewerId, user.id))) return null;

  const progress = await db.userGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId } },
    select: {
      unlockedCount: true,
      totalCount: true,
      completion: true,
      playtimeMinutes: true,
      hidden: true,
    },
  });
  if (!progress || (progress.hidden && !self)) return null;

  const unlocks = await db.userAchievement.findMany({
    where: { userId: user.id, achievement: { gameId } },
    select: { achievementId: true, unlockedAt: true },
  });
  return {
    user: { ...user, isPublic: undefined, accounts: undefined },
    self,
    /** Vrai quand Steam ne donne aucun temps de jeu pour ce joueur. */
    steamPlaytimeHidden: user.accounts.some((account) => account.playtimeHidden),
    progress: {
      unlockedCount: progress.unlockedCount,
      totalCount: progress.totalCount,
      completion: progress.completion,
      playtimeMinutes: progress.playtimeMinutes,
    },
    unlocks,
  };
}

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
