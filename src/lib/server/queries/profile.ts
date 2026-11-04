import { db } from '../db';
import { bestCards, chosenCards, profileCards } from './library';
import { userStats } from './stats';
import { MAX_SHOWCASE, cardSelect, publicUser, visibleGames } from './shared';

export async function dashboard(userId: string, showAdult = false) {
  const [recent, almost, stats] = await Promise.all([
    db.userGame.findMany({
      where: {
        userId,
        hidden: false,
        game: visibleGames(showAdult),
        lastUnlockedAt: { not: null },
      },
      orderBy: { lastUnlockedAt: 'desc' },
      take: 4,
      select: cardSelect,
    }),
    db.userGame.findMany({
      where: {
        userId,
        hidden: false,
        game: visibleGames(showAdult),
        completion: { gte: 50, lt: 100 },
      },
      orderBy: { completion: 'desc' },
      take: 4,
      select: cardSelect,
    }),
    userStats(userId),
  ]);
  return { recent, almost, stats };
}

export async function userProfile(handle: string, viewerId: string | null, showAdult = false) {
  const user = await db.user.findUnique({
    where: { handle },
    select: {
      id: true,
      ...publicUser,
      showcaseCustom: true,
      isPublic: true,
      createdAt: true,
      clanMember: { select: { clan: { select: { name: true, slug: true } } } },
      accounts: {
        where: { provider: { notIn: ['DISCORD', 'GOOGLE'] } },
        select: { provider: true, displayName: true, profileUrl: true },
      },
    },
  });
  if (!user || (!user.isPublic && user.id !== viewerId)) return null;

  const [stats, library, pins, recent] = await Promise.all([
    userStats(user.id),
    profileCards(user.id, showAdult),
    db.pinnedGame.findMany({
      where: { userId: user.id },
      orderBy: { position: 'asc' },
      select: { game: { select: { slug: true } } },
    }),
    db.userAchievement.findMany({
      where: {
        userId: user.id,
        achievement: {
          game: {
            ...visibleGames(showAdult),
            players: { none: { userId: user.id, hidden: true } },
          },
        },
      },
      orderBy: { unlockedAt: 'desc' },
      take: 8,
      select: {
        unlockedAt: true,
        achievement: {
          select: {
            id: true,
            name: true,
            iconUrl: true,
            trophyType: true,
            game: { select: { name: true, slug: true } },
          },
        },
      },
    }),
  ]);
  const cards = bestCards(library);
  const chosen = chosenCards(
    cards,
    pins.map((pin) => pin.game.slug),
  );
  // Une sélection vide ou masquée au visiteur ne laisse pas une vitrine vide.
  const showcase = (user.showcaseCustom && chosen.length ? chosen : cards).slice(0, MAX_SHOWCASE);
  return { user, stats, showcase, games: library.slice(0, 24), recent };
}

/** Compare deux joueurs sur les jeux qu'ils possèdent tous les deux. */
export async function compareUsers(a: string, b: string, showAdult = false) {
  const [left, right] = await Promise.all([
    db.userGame.findMany({
      where: { userId: a, hidden: false, game: visibleGames(showAdult) },
      select: cardSelect,
    }),
    db.userGame.findMany({
      where: { userId: b, hidden: false, game: visibleGames(showAdult) },
      select: cardSelect,
    }),
  ]);
  const rightByGame = new Map(right.map((row) => [row.game.id, row]));
  return left
    .flatMap((row) => {
      const other = rightByGame.get(row.game.id);
      return other ? [{ game: row.game, left: row, right: other }] : [];
    })
    .sort((x, y) => x.game.name.localeCompare(y.game.name, 'fr'));
}
