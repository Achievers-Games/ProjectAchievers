import { Prisma, type Platform } from '@prisma/client';
import { db } from './db';
import { groupLibrary } from './library';

export const PAGE_SIZE = 36;

/** Les jeux adultes restent masqués tant que le visiteur ne les a pas demandés. */
export const visibleGames = (showAdult = false) =>
  (showAdult ? {} : { adultOnly: false }) satisfies Prisma.GameWhereInput;

interface GameFilters {
  q?: string;
  platform?: Platform;
  sort: 'nom' | 'recent' | 'progression' | 'succes';
  page: number;
  ownerId?: string;
  /** Avec `ownerId` : seulement les jeux à succès qui ne sont pas encore à 100 %. */
  unfinished?: boolean;
  /** Avec `ownerId` : montre les jeux cachés par le joueur, et seulement eux. */
  hidden?: boolean;
  showAdult?: boolean;
}

const librarySelect = {
  unlockedCount: true,
  completion: true,
  platinum: true,
  lastUnlockedAt: true,
  game: {
    select: {
      id: true,
      name: true,
      slug: true,
      platform: true,
      coverUrl: true,
      headerUrl: true,
      totalAchievements: true,
      familyKey: true,
    },
  },
} satisfies Prisma.UserGameSelect;

/** Bibliothèque d'un joueur : les versions d'un même jeu forment une seule carte. */
async function listLibrary(filters: GameFilters, ownerId: string, where: Prisma.GameWhereInput) {
  const rows = await db.userGame.findMany({
    where: { userId: ownerId, hidden: Boolean(filters.hidden), game: where },
    select: librarySelect,
  });
  const cards = groupLibrary(rows).filter(
    (card) => !filters.unfinished || (card.progress.completion < 100 && card.totalAchievements > 0),
  );

  const byName = (a: (typeof cards)[number], b: (typeof cards)[number]) =>
    a.name.localeCompare(b.name, 'fr');
  cards.sort((a, b) => {
    if (filters.sort === 'succes') {
      return b.totalAchievements - a.totalAchievements || byName(a, b);
    }
    if (filters.sort === 'progression') {
      return b.progress.completion - a.progress.completion || byName(a, b);
    }
    if (filters.sort === 'recent') {
      const time = (card: typeof a) => card.lastUnlockedAt?.getTime() ?? 0;
      return time(b) - time(a) || byName(a, b);
    }
    return byName(a, b);
  });

  const start = (filters.page - 1) * PAGE_SIZE;
  return { games: cards.slice(start, start + PAGE_SIZE), total: cards.length };
}

export async function listGames(filters: GameFilters, viewerId: string | null) {
  const where: Prisma.GameWhereInput = {
    ...visibleGames(filters.showAdult),
    ...(filters.q && { name: { contains: filters.q, mode: 'insensitive' } }),
    ...(filters.platform && { platform: filters.platform }),
  };
  if (filters.ownerId) return listLibrary(filters, filters.ownerId, where);

  // L'identifiant départage les égalités : sans lui, un jeu pourrait passer d'une page à l'autre.
  const orderBy: Prisma.GameOrderByWithRelationInput[] = [
    filters.sort === 'succes'
      ? { totalAchievements: 'desc' }
      : filters.sort === 'recent'
        ? { updatedAt: 'desc' }
        : { name: 'asc' },
    { id: 'asc' },
  ];

  const [games, total] = await Promise.all([
    db.game.findMany({
      where,
      orderBy,
      take: PAGE_SIZE,
      skip: (filters.page - 1) * PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        platform: true,
        coverUrl: true,
        headerUrl: true,
        totalAchievements: true,
      },
    }),
    db.game.count({ where }),
  ]);
  const items = await withProgress(games, viewerId);
  return { games: items.map((game) => ({ ...game, versions: [], tier: 0, next: null })), total };
}

async function withProgress<T extends { id: string }>(games: T[], viewerId: string | null) {
  if (!viewerId) return games.map((game) => ({ ...game, progress: null }));
  const rows = await db.userGame.findMany({
    where: { userId: viewerId, gameId: { in: games.map((g) => g.id) } },
    select: { gameId: true, unlockedCount: true, completion: true, platinum: true },
  });
  const byGame = new Map(rows.map((r) => [r.gameId, r]));
  return games.map((game) => ({ ...game, progress: byGame.get(game.id) ?? null }));
}

export type GameListItem = Awaited<ReturnType<typeof listGames>>['games'][number];

const profileGameSelect = {
  unlockedCount: true,
  totalCount: true,
  completion: true,
  platinum: true,
  lastUnlockedAt: true,
  game: {
    select: {
      id: true,
      name: true,
      slug: true,
      platform: true,
      coverUrl: true,
      headerUrl: true,
      totalAchievements: true,
    },
  },
} satisfies Prisma.UserGameSelect;

/** Les jeux terminés : 100 % des succès, DLC compris. */
export const RARE_CARD = {
  completion: { gte: 100 },
} satisfies Prisma.UserGameWhereInput;

/** Dernières cartes obtenues par les profils publics, à la date du dernier succès. */
export async function cardFeed(showAdult = false, limit = 12) {
  const rows = await db.userGame.findMany({
    where: {
      ...RARE_CARD,
      hidden: false,
      user: { isPublic: true },
      game: visibleGames(showAdult),
      lastUnlockedAt: { not: null },
    },
    orderBy: { lastUnlockedAt: 'desc' },
    take: limit,
    select: {
      lastUnlockedAt: true,
      user: { select: { handle: true, displayName: true, avatarUrl: true } },
      game: { select: { name: true, slug: true, headerUrl: true } },
    },
  });
  return rows.map(({ lastUnlockedAt, ...row }) => ({
    ...row,
    unlockedAt: lastUnlockedAt as Date,
  }));
}

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
      select: profileGameSelect,
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
      select: profileGameSelect,
    }),
    userStats(userId),
  ]);
  return { recent, almost, stats };
}

export async function userStats(userId: string) {
  const [collection, totals] = await Promise.all([
    db.$queryRaw<
      { games: bigint; or: bigint; platine: bigint; prismatique: bigint; legendaire: bigint }[]
    >`
      SELECT count(*) AS games,
             count(*) FILTER (WHERE finished = 1) AS "or",
             count(*) FILTER (WHERE finished = 2) AS platine,
             count(*) FILTER (WHERE finished = 3) AS prismatique,
             count(*) FILTER (WHERE finished >= 4) AS legendaire
      FROM (
        SELECT count(DISTINCT g.platform) FILTER (WHERE ug.completion >= 100) AS finished
        FROM "UserGame" ug
        JOIN "Game" g ON g.id = ug."gameId"
        WHERE ug."userId" = ${userId}
        GROUP BY COALESCE(g."familyKey", g.id)
      ) families`,
    db.$queryRaw<{ unlocked: bigint; points: bigint | null }[]>`
      SELECT count(*) AS unlocked, sum(a.points) AS points
      FROM "UserAchievement" ua
      JOIN "Achievement" a ON a.id = ua."achievementId"
      WHERE ua."userId" = ${userId}`,
  ]);
  return {
    games: Number(collection[0]?.games ?? 0),
    tiers: {
      or: Number(collection[0]?.or ?? 0),
      platine: Number(collection[0]?.platine ?? 0),
      prismatique: Number(collection[0]?.prismatique ?? 0),
      legendaire: Number(collection[0]?.legendaire ?? 0),
    },
    unlocked: Number(totals[0]?.unlocked ?? 0),
    points: Number(totals[0]?.points ?? 0),
  };
}

export async function userProfile(handle: string, viewerId: string | null, showAdult = false) {
  const user = await db.user.findUnique({
    where: { handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      isPublic: true,
      createdAt: true,
      accounts: {
        where: { provider: { notIn: ['DISCORD', 'GOOGLE'] } },
        select: { provider: true, displayName: true, profileUrl: true },
      },
    },
  });
  if (!user || (!user.isPublic && user.id !== viewerId)) return null;

  const [stats, showcaseRows, gameRows, recent] = await Promise.all([
    userStats(user.id),
    db.userGame.findMany({
      where: { userId: user.id, hidden: false, game: visibleGames(showAdult), ...RARE_CARD },
      orderBy: [{ lastUnlockedAt: { sort: 'desc', nulls: 'last' } }],
      select: librarySelect,
    }),
    db.userGame.findMany({
      where: { userId: user.id, hidden: false, game: visibleGames(showAdult) },
      orderBy: [{ lastUnlockedAt: { sort: 'desc', nulls: 'last' } }],
      take: 60,
      select: librarySelect,
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
  const showcase = groupLibrary(showcaseRows)
    .sort((a, b) => b.tier - a.tier)
    .slice(0, 8);
  return { user, stats, showcase, games: groupLibrary(gameRows).slice(0, 24), recent };
}

export type LeaderboardPeriod = 'semaine' | 'mois' | 'tout';

const PERIOD_DAYS: Record<LeaderboardPeriod, number | null> = {
  semaine: 7,
  mois: 30,
  tout: null,
};

export async function leaderboard(period: LeaderboardPeriod, limit = 20) {
  const days = PERIOD_DAYS[period];
  const since = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  const rows = await db.$queryRaw<
    {
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      unlocked: bigint;
      points: bigint;
    }[]
  >`
    SELECT u.handle, u."displayName", u."avatarUrl",
           count(*) AS unlocked, sum(a.points) AS points
    FROM "UserAchievement" ua
    JOIN "User" u ON u.id = ua."userId" AND u."isPublic"
    JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE ua."unlockedAt" >= ${since}
    GROUP BY u.id
    ORDER BY points DESC, unlocked DESC
    LIMIT ${limit}`;
  return rows.map((row) => ({
    ...row,
    unlocked: Number(row.unlocked),
    points: Number(row.points),
  }));
}

export function activityFeed(showAdult = false, limit = 30) {
  return db.userAchievement.findMany({
    where: { user: { isPublic: true }, achievement: { game: visibleGames(showAdult) } },
    orderBy: { unlockedAt: 'desc' },
    take: limit,
    select: {
      unlockedAt: true,
      user: { select: { handle: true, displayName: true, avatarUrl: true } },
      achievement: {
        select: {
          id: true,
          name: true,
          iconUrl: true,
          trophyType: true,
          globalRarity: true,
          game: { select: { name: true, slug: true } },
        },
      },
    },
  });
}

/** Compare deux joueurs sur les jeux qu'ils possèdent tous les deux. */
export async function compareUsers(a: string, b: string, showAdult = false) {
  const [left, right] = await Promise.all([
    db.userGame.findMany({
      where: { userId: a, hidden: false, game: visibleGames(showAdult) },
      select: profileGameSelect,
    }),
    db.userGame.findMany({
      where: { userId: b, hidden: false, game: visibleGames(showAdult) },
      select: profileGameSelect,
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
