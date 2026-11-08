import type { Platform, Prisma } from '#prisma';
import { db } from './db';
import {
  absolute,
  apiGame,
  apiGameSelect,
  nextCursor,
  type ApiCursor,
  type ApiGameStatus,
  type ApiSort,
} from './partner-api';
import { userStats } from './queries/stats';
import { visibleGames } from './queries/shared';

/**
 * Ce que l'API publique lit d'un joueur : exactement ce qu'un visiteur anonyme voit sur son
 * profil. Profil privé, jeu masqué ou jeu adulte : rien ne sort.
 */
const publicPlayer = (handle: string) =>
  db.user.findFirst({
    where: { handle, isPublic: true },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      createdAt: true,
      clanMember: { select: { clan: { select: { name: true, slug: true } } } },
    },
  });

const shownGames = { hidden: false, game: visibleGames(false) };

const progress = (row: {
  unlockedCount: number;
  totalCount: number;
  completion: number;
  platinum: boolean;
  lastUnlockedAt: Date | null;
  updatedAt: Date;
}) => ({
  unlocked: row.unlockedCount,
  total: row.totalCount,
  completion: Math.round(row.completion * 10) / 10,
  completed: row.completion >= 100,
  platinum: row.platinum,
  lastUnlockedAt: row.lastUnlockedAt?.toISOString() ?? null,
  // Ni temps de jeu ni dernière session : le site ne les montre à personne, l'API non plus.
  // Le moment où Achievers a réécrit cette progression : `?since=` s'appuie dessus.
  updatedAt: row.updatedAt.toISOString(),
});

const progressSelect = {
  unlockedCount: true,
  totalCount: true,
  completion: true,
  platinum: true,
  lastUnlockedAt: true,
  updatedAt: true,
} as const;

export async function partnerUser(handle: string) {
  const user = await publicPlayer(handle);
  if (!user) return null;
  const stats = await userStats(user.id);
  const clan = user.clanMember?.clan;
  return {
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    url: absolute(`/u/${user.handle}`),
    cardUrl: absolute(`/u/${user.handle}/carte.svg`),
    memberSince: user.createdAt.toISOString(),
    clan: clan ? { name: clan.name, slug: clan.slug, url: absolute(`/clans/${clan.slug}`) } : null,
    stats: {
      games: stats.games,
      achievements: stats.unlocked,
      cards: stats.tiers.reduce((sum, count) => sum + count, 0),
      cardsByTier: stats.tiers,
      points: stats.points,
    },
  };
}

const orderFor = (sort: ApiSort): Prisma.UserGameOrderByWithRelationInput[] =>
  sort === 'name'
    ? [{ game: { name: 'asc' } }, { gameId: 'asc' }]
    : sort === 'completion'
      ? [{ completion: 'desc' }, { gameId: 'asc' }]
      : sort === 'lastUnlocked'
        ? [{ lastUnlockedAt: { sort: 'desc', nulls: 'last' } }, { gameId: 'asc' }]
        : sort === 'updated'
          ? [{ updatedAt: 'desc' }, { gameId: 'asc' }]
          : [{ gameId: 'asc' }];

/** Reprendre après le dernier élément rendu : sa valeur de tri, puis son identifiant. */
const afterCursor = (sort: ApiSort, cursor: ApiCursor): Prisma.UserGameWhereInput => {
  switch (sort) {
    case 'default':
      return { gameId: { gt: cursor.id } };
    case 'completion': {
      const value = Number(cursor.value);
      return {
        OR: [{ completion: { lt: value } }, { completion: value, gameId: { gt: cursor.id } }],
      };
    }
    case 'updated': {
      const value = new Date(String(cursor.value));
      return {
        OR: [{ updatedAt: { lt: value } }, { updatedAt: value, gameId: { gt: cursor.id } }],
      };
    }
    case 'lastUnlocked': {
      const value = cursor.value === null ? null : new Date(String(cursor.value));
      // Les jeux jamais débloqués viennent en dernier : on les parcourt les uns après les autres.
      return value
        ? {
            OR: [
              { lastUnlockedAt: { lt: value } },
              { lastUnlockedAt: value, gameId: { gt: cursor.id } },
              { lastUnlockedAt: null },
            ],
          }
        : { lastUnlockedAt: null, gameId: { gt: cursor.id } };
    }
    case 'name': {
      const value = String(cursor.value);
      return {
        OR: [
          { game: { name: { gt: value } } },
          { game: { name: value }, gameId: { gt: cursor.id } },
        ],
      };
    }
  }
};

export interface UserGamesFilter {
  platform: Platform | null;
  limit: number;
  cursor: ApiCursor | null;
  sort?: ApiSort;
  status?: ApiGameStatus | null;
  /** Ne rend que les progressions réécrites à partir de cet instant. */
  since?: Date | null;
}

export async function partnerUserGames(
  handle: string,
  { platform, limit, cursor, sort = 'default', status = null, since = null }: UserGamesFilter,
) {
  const user = await publicPlayer(handle);
  if (!user) return null;

  const game: Prisma.GameWhereInput = { ...visibleGames(false) };
  if (platform) game.platform = platform;

  const where: Prisma.UserGameWhereInput = { userId: user.id, hidden: false, game };
  if (status === 'completed') where.completion = { gte: 100 };
  else if (status === 'started') where.completion = { gt: 0, lt: 100 };
  else if (status === 'untouched') where.completion = { lte: 0 };
  if (since) where.updatedAt = { gte: since };
  if (cursor) where.AND = [afterCursor(sort, cursor)];

  const rows = await db.userGame.findMany({
    where,
    orderBy: orderFor(sort),
    take: limit + 1,
    select: { gameId: true, ...progressSelect, game: { select: apiGameSelect } },
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ game: apiGame(row.game), progress: progress(row) })),
    nextCursor: rows.length > limit && last ? nextCursor(sort, last) : null,
  };
}

/** Le détail d'un jeu pour un joueur : chaque succès, obtenu ou non. */
export async function partnerUserGame(handle: string, platform: Platform, platformGameId: string) {
  const user = await publicPlayer(handle);
  if (!user) return null;
  const row = await db.userGame.findFirst({
    where: {
      userId: user.id,
      ...shownGames,
      game: { ...visibleGames(false), platform, platformGameId },
    },
    select: {
      ...progressSelect,
      game: {
        select: {
          ...apiGameSelect,
          achievements: {
            orderBy: [{ globalRarity: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
            select: {
              id: true,
              platformAchievementId: true,
              name: true,
              description: true,
              iconUrl: true,
              iconLockedUrl: true,
              hidden: true,
              trophyType: true,
              globalRarity: true,
              points: true,
              missable: true,
              unlocks: { where: { userId: user.id }, select: { unlockedAt: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  const { achievements, ...game } = row.game;
  return {
    game: apiGame(game),
    progress: progress(row),
    achievements: achievements.map((a) => {
      const unlockedAt = a.unlocks[0]?.unlockedAt ?? null;
      // Comme sur le site : un succès caché reste secret tant que le joueur ne l'a pas.
      const secret = a.hidden && !unlockedAt;
      return {
        id: a.platformAchievementId,
        name: secret ? null : a.name,
        description: secret ? null : a.description,
        iconUrl: secret ? null : unlockedAt ? a.iconUrl : (a.iconLockedUrl ?? a.iconUrl),
        hidden: a.hidden,
        trophyType: a.trophyType.toLowerCase(),
        rarity: a.globalRarity,
        points: a.points,
        // Un succès manquable se perd pour la partie en cours : le partenaire peut prévenir.
        missable: a.missable,
        unlocked: unlockedAt !== null,
        unlockedAt: unlockedAt?.toISOString() ?? null,
      };
    }),
  };
}

/** Un jeu à partir de son identifiant de plateforme, l'appid Steam par exemple. */
export async function partnerGame(platform: Platform, platformGameId: string) {
  const game = await db.game.findFirst({
    where: { ...visibleGames(false), platform, platformGameId },
    select: { id: true, ...apiGameSelect },
  });
  if (!game) return null;
  const players = { gameId: game.id, hidden: false, user: { isPublic: true } };
  const [playerCount, completedCount] = await Promise.all([
    db.userGame.count({ where: players }),
    db.userGame.count({ where: { ...players, completion: { gte: 100 } } }),
  ]);
  return {
    ...apiGame(game),
    players: playerCount,
    completions: completedCount,
    completionRate: playerCount ? Math.round((completedCount / playerCount) * 1000) / 10 : null,
  };
}
