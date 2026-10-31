import { Prisma, type Platform } from '@prisma/client';
import { db } from './db';
import { groupLibrary, type LibraryCard } from './library';

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
  /** Avec `ownerId` : seulement les jeux qui ont encore une version à terminer. */
  unfinished?: boolean;
  /** Avec `ownerId` : seulement les cartes de ce niveau. */
  tier?: number;
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

/** Le pourcentage affiché sur la carte : celui du niveau suivant, s'il est en cours. */
const shownProgress = (card: LibraryCard) => card.next?.completion ?? card.progress.completion;

/** Position sur l'échelle des niveaux : une carte Or à 58 % du Platine vaut 1,58. */
const tierProgress = (card: LibraryCard) =>
  card.tier + (card.tier ? (card.next?.completion ?? 0) : card.progress.completion) / 100;

/** Bibliothèque d'un joueur : les versions d'un même jeu forment une seule carte. */
async function listLibrary(filters: GameFilters, ownerId: string, where: Prisma.GameWhereInput) {
  const rows = await db.userGame.findMany({
    where: { userId: ownerId, hidden: Boolean(filters.hidden), game: where },
    select: librarySelect,
  });
  // Le niveau dépend de toutes les versions : la plateforme se filtre une fois les cartes réunies.
  const cards = groupLibrary(rows).filter(
    (card) =>
      (!filters.platform || card.versions.some((v) => v.platform === filters.platform)) &&
      (!filters.tier || card.tier === filters.tier) &&
      (!filters.unfinished ||
        Boolean(card.next) ||
        (card.progress.completion < 100 && card.totalAchievements > 0)),
  );

  const byName = (a: (typeof cards)[number], b: (typeof cards)[number]) =>
    a.name.localeCompare(b.name, 'fr');
  cards.sort((a, b) => {
    if (filters.sort === 'succes') {
      return b.totalAchievements - a.totalAchievements || byName(a, b);
    }
    if (filters.sort === 'progression') {
      // Dans « Non 100 % », seul compte ce qui est presque fini.
      const rank = filters.unfinished ? shownProgress : tierProgress;
      return rank(b) - rank(a) || byName(a, b);
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
  };
  if (filters.ownerId) return listLibrary(filters, filters.ownerId, where);
  if (filters.platform) where.platform = filters.platform;

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
      user: {
        select: {
          handle: true,
          displayName: true,
          avatarUrl: true,
          avatarMotionUrl: true,
          frame: true,
        },
      },
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

/** Chaque niveau vaut trois fois le précédent : une Légendaire pèse 27 cartes Or. */
const TIER_POINTS = [100, 300, 900, 2700];

/** Les seuls points du site : ceux des succès ne seraient pas comparables d'une plateforme à l'autre. */
const cardScore = (tiers: number[]) =>
  tiers.reduce((sum, count, index) => sum + count * (TIER_POINTS[index] ?? 0), 0);

export interface BannerGame {
  name: string;
  slug: string;
  images: string[];
  completion: number | null;
}

/** Steam a une grande image pour la plupart des jeux ; l'en-tête prend le relais sinon. */
const bannerImages = (headerUrl: string) =>
  headerUrl.endsWith('/header.jpg')
    ? [headerUrl.replace('/header.jpg', '/library_hero.jpg'), headerUrl]
    : [headerUrl];

const BANNERS = 3;

/** Les jeux les plus proches de la fin ; à défaut, ou pour un invité, des jeux au hasard. */
export async function bannerGames(userId?: string): Promise<BannerGame[]> {
  const library = userId
    ? await listGames({ sort: 'progression', page: 1, ownerId: userId, unfinished: true }, userId)
    : null;
  const closest = (library?.games ?? [])
    .filter((game) => game.headerUrl)
    .slice(0, BANNERS)
    .map((game) => ({
      name: game.name,
      slug: game.slug,
      images: bannerImages(game.headerUrl as string),
      completion: game.next?.completion ?? game.progress?.completion ?? null,
    }));
  if (closest.length === BANNERS) return closest;

  // Un jeu pas encore classé pourrait être un jeu adulte : il ne s'affiche pas à l'accueil.
  const random = await db.$queryRaw<{ name: string; slug: string; headerUrl: string }[]>`
    SELECT name, slug, "headerUrl"
    FROM "Game"
    WHERE NOT "adultOnly" AND "headerUrl" IS NOT NULL AND "totalAchievements" > 0
      AND (platform <> 'STEAM' OR "contentCheckedAt" IS NOT NULL)
    ORDER BY random()
    LIMIT ${BANNERS - closest.length}`;
  return [
    ...closest,
    ...random.map((game) => ({
      name: game.name,
      slug: game.slug,
      images: bannerImages(game.headerUrl),
      completion: null,
    })),
  ];
}

export async function userStats(userId: string) {
  const [collection, unlocked] = await Promise.all([
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
        WHERE ug."userId" = ${userId} AND NOT ug.hidden
        GROUP BY COALESCE(g."familyKey", g.id)
      ) families`,
    db.userAchievement.count({ where: { userId } }),
  ]);
  const tiers = {
    or: Number(collection[0]?.or ?? 0),
    platine: Number(collection[0]?.platine ?? 0),
    prismatique: Number(collection[0]?.prismatique ?? 0),
    legendaire: Number(collection[0]?.legendaire ?? 0),
  };
  return {
    games: Number(collection[0]?.games ?? 0),
    tiers,
    unlocked,
    points: cardScore([tiers.or, tiers.platine, tiers.prismatique, tiers.legendaire]),
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
      avatarMotionUrl: true,
      frame: true,
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
      avatarMotionUrl: string | null;
      frame: string | null;
      unlocked: bigint;
    }[]
  >`
    SELECT u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame,
           count(*) AS unlocked
    FROM "UserAchievement" ua
    JOIN "User" u ON u.id = ua."userId" AND u."isPublic"
    WHERE ua."unlockedAt" >= ${since}
    GROUP BY u.id
    ORDER BY unlocked DESC, u.handle
    LIMIT ${limit}`;
  return rows.map((row) => ({ ...row, unlocked: Number(row.unlocked) }));
}

/** Classement des collections : seules les cartes comptent, pas le nombre de succès. */
export async function collectors(limit = 100) {
  const rows = await db.$queryRaw<
    {
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      or: bigint;
      platine: bigint;
      prismatique: bigint;
      legendaire: bigint;
    }[]
  >`
    SELECT u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame,
           count(*) FILTER (WHERE finished = 1) AS "or",
           count(*) FILTER (WHERE finished = 2) AS platine,
           count(*) FILTER (WHERE finished = 3) AS prismatique,
           count(*) FILTER (WHERE finished >= 4) AS legendaire
    FROM (
      SELECT ug."userId", count(DISTINCT g.platform) AS finished
      FROM "UserGame" ug
      JOIN "Game" g ON g.id = ug."gameId"
      WHERE ug.completion >= 100 AND NOT ug.hidden
      GROUP BY ug."userId", COALESCE(g."familyKey", g.id)
    ) cards
    JOIN "User" u ON u.id = cards."userId" AND u."isPublic"
    GROUP BY u.id`;

  return rows
    .map(({ or, platine, prismatique, legendaire, ...user }) => {
      const tiers = [or, platine, prismatique, legendaire].map(Number);
      return {
        ...user,
        tiers,
        cards: tiers.reduce((sum, count) => sum + count, 0),
        score: cardScore(tiers),
      };
    })
    .sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle))
    .slice(0, limit);
}

export type Collector = Awaited<ReturnType<typeof collectors>>[number];

export function activityFeed(showAdult = false, limit = 30) {
  return db.userAchievement.findMany({
    where: { user: { isPublic: true }, achievement: { game: visibleGames(showAdult) } },
    orderBy: { unlockedAt: 'desc' },
    take: limit,
    select: {
      unlockedAt: true,
      user: {
        select: {
          handle: true,
          displayName: true,
          avatarUrl: true,
          avatarMotionUrl: true,
          frame: true,
        },
      },
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
