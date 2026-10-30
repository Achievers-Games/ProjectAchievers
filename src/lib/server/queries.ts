import { Prisma, type Platform } from '@prisma/client';
import { db } from './db';

export const PAGE_SIZE = 36;

export interface GameFilters {
  q?: string;
  platform?: Platform;
  sort: 'nom' | 'recent' | 'progression' | 'succes';
  page: number;
  ownerId?: string;
}

export async function listGames(filters: GameFilters, viewerId: string | null) {
  const where: Prisma.GameWhereInput = {
    ...(filters.q && { name: { contains: filters.q, mode: 'insensitive' } }),
    ...(filters.platform && { platform: filters.platform }),
    ...(filters.ownerId && { players: { some: { userId: filters.ownerId } } }),
  };
  const orderBy: Prisma.GameOrderByWithRelationInput =
    filters.sort === 'succes'
      ? { totalAchievements: 'desc' }
      : filters.sort === 'recent'
        ? { updatedAt: 'desc' }
        : { name: 'asc' };

  const select = {
    id: true,
    name: true,
    slug: true,
    platform: true,
    coverUrl: true,
    headerUrl: true,
    totalAchievements: true,
  } satisfies Prisma.GameSelect;

  // Trier par progression demande les lignes du joueur : on part donc de UserGame.
  if (filters.sort === 'progression' && filters.ownerId) {
    const [rows, total] = await Promise.all([
      db.userGame.findMany({
        where: { userId: filters.ownerId, game: where },
        orderBy: [{ completion: 'desc' }, { lastUnlockedAt: 'desc' }],
        take: PAGE_SIZE,
        skip: (filters.page - 1) * PAGE_SIZE,
        select: { game: { select } },
      }),
      db.game.count({ where }),
    ]);
    return {
      games: await withProgress(
        rows.map((r) => r.game),
        viewerId,
      ),
      total,
    };
  }

  const [games, total] = await Promise.all([
    db.game.findMany({
      where,
      orderBy,
      take: PAGE_SIZE,
      skip: (filters.page - 1) * PAGE_SIZE,
      select,
    }),
    db.game.count({ where }),
  ]);
  return { games: await withProgress(games, viewerId), total };
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

export async function dashboard(userId: string) {
  const [recent, almost, stats] = await Promise.all([
    db.userGame.findMany({
      where: { userId, lastUnlockedAt: { not: null } },
      orderBy: { lastUnlockedAt: 'desc' },
      take: 4,
      select: profileGameSelect,
    }),
    db.userGame.findMany({
      where: { userId, completion: { gte: 50, lt: 100 } },
      orderBy: { completion: 'desc' },
      take: 4,
      select: profileGameSelect,
    }),
    userStats(userId),
  ]);
  return { recent, almost, stats };
}

export async function userStats(userId: string) {
  const [games, platinums, totals] = await Promise.all([
    db.userGame.count({ where: { userId } }),
    db.userGame.count({ where: { userId, platinum: true } }),
    db.$queryRaw<{ unlocked: bigint; points: bigint | null }[]>`
      SELECT count(*) AS unlocked, sum(a.points) AS points
      FROM "UserAchievement" ua
      JOIN "Achievement" a ON a.id = ua."achievementId"
      WHERE ua."userId" = ${userId}`,
  ]);
  return {
    games,
    platinums,
    unlocked: Number(totals[0]?.unlocked ?? 0),
    points: Number(totals[0]?.points ?? 0),
  };
}

export async function userProfile(handle: string, viewerId: string | null) {
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

  const [stats, games, recent] = await Promise.all([
    userStats(user.id),
    db.userGame.findMany({
      where: { userId: user.id },
      orderBy: [{ lastUnlockedAt: { sort: 'desc', nulls: 'last' } }],
      take: 24,
      select: profileGameSelect,
    }),
    db.userAchievement.findMany({
      where: { userId: user.id },
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
  return { user, stats, games, recent };
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

export function activityFeed(limit = 30) {
  return db.userAchievement.findMany({
    where: { user: { isPublic: true } },
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
export async function compareUsers(a: string, b: string) {
  const [left, right] = await Promise.all([
    db.userGame.findMany({ where: { userId: a }, select: profileGameSelect }),
    db.userGame.findMany({ where: { userId: b }, select: profileGameSelect }),
  ]);
  const rightByGame = new Map(right.map((row) => [row.game.id, row]));
  return left
    .flatMap((row) => {
      const other = rightByGame.get(row.game.id);
      return other ? [{ game: row.game, left: row, right: other }] : [];
    })
    .sort((x, y) => x.game.name.localeCompare(y.game.name, 'fr'));
}
