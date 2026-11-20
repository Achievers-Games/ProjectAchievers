import { db } from './db';

export async function bannerProgress(userId: string, familyKeys: string[]) {
  const scores = new Map<string, number>();
  if (!familyKeys.length) return scores;
  const games = await db.userGame.findMany({
    where: { userId, hidden: false, game: { adultOnly: false, familyKey: { in: familyKeys } } },
    select: { completion: true, game: { select: { familyKey: true } } },
  });
  for (const { completion, game } of games) {
    if (game.familyKey) {
      scores.set(game.familyKey, Math.max(scores.get(game.familyKey) ?? 0, completion));
    }
  }
  return scores;
}

/** Seules les familles terminées sur une version publique et non adulte sont équipables. */
export async function completedBannerGames(userId: string, familyKeys: string[]) {
  if (!familyKeys.length) return [];
  return db.game.findMany({
    where: {
      familyKey: { in: familyKeys },
      adultOnly: false,
      players: { some: { userId, hidden: false, completion: 100 } },
    },
    orderBy: [{ headerUrl: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    select: { familyKey: true, name: true, slug: true, headerUrl: true },
  });
}

export async function resolveCardBanner(userId: string, editionId: string) {
  const owned = await db.userEdition.findUnique({
    where: { userId_editionId: { userId, editionId } },
    select: {
      edition: { select: { kind: true, assetPath: true, familyKey: true, enabled: true } },
    },
  });
  if (!owned?.edition.enabled) return null;
  const { kind, assetPath, familyKey } = owned.edition;
  const [game] = await completedBannerGames(userId, [familyKey]);
  return game ? { kind, assetPath, game } : null;
}

export async function profileCardBanner(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { bannerEditionId: true },
  });
  return user?.bannerEditionId ? resolveCardBanner(userId, user.bannerEditionId) : null;
}
