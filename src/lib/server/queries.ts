import { Prisma, type Platform } from '@prisma/client';
import { db } from './db';
import { groupLibrary, type LibraryCard } from './library';
import { consolesOf, TIERS } from '$lib/collection';
import { RARITY_POINTS, SEASON, seasonState, type Season } from '$lib/season';

export const PAGE_SIZE = 36;

/** Les jeux adultes restent masqués tant que le visiteur ne les a pas demandés. */
export const visibleGames = (showAdult = false) =>
  (showAdult ? {} : { adultOnly: false }) satisfies Prisma.GameWhereInput;

/** Un jeu Steam pas encore classé pourrait être un jeu adulte : il reste hors des fils publics. */
export const publicGames = {
  adultOnly: false,
  OR: [{ platform: { not: 'STEAM' } }, { contentCheckedAt: { not: null } }],
} satisfies Prisma.GameWhereInput;

export const isPublicGame = (game: {
  adultOnly: boolean;
  platform: Platform;
  contentCheckedAt: Date | null;
}) => !game.adultOnly && (game.platform !== 'STEAM' || game.contentCheckedAt !== null);

/** Ce qu'un profil montre de lui partout sur le site. */
export const publicUser = {
  handle: true,
  displayName: true,
  avatarUrl: true,
  avatarMotionUrl: true,
  frame: true,
  frameMotionUrl: true,
} satisfies Prisma.UserSelect;

interface GameFilters {
  q?: string;
  platform?: Platform;
  /** Des consoles précises de la plateforme : PS4, ou One et Series pour Xbox. */
  consoles?: string[];
  sort: 'nom' | 'recent' | 'progression' | 'succes' | 'rarete';
  page: number;
  ownerId?: string;
  /** Avec `ownerId` : seulement les jeux qui ont encore une version à terminer. */
  unfinished?: boolean;
  /** Avec `ownerId` : seulement les jeux qui comptent pour la saison en cours. */
  seasonOnly?: boolean;
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
      console: true,
      coverUrl: true,
      headerUrl: true,
      totalAchievements: true,
      familyKey: true,
      tier: true,
    },
  },
} satisfies Prisma.UserGameSelect;

/** Le pourcentage affiché sur la carte : celui de l'exemplaire suivant, s'il est en cours. */
const shownProgress = (card: LibraryCard) => card.next?.completion ?? card.progress.completion;

/** Position sur l'échelle : une carte Or à 58 % de son exemplaire suivant vaut 3,58. */
const tierProgress = (card: LibraryCard) =>
  card.tier
    ? card.tier * 10 + card.copies + (card.next?.completion ?? 0) / 100
    : card.progress.completion / 100;

/** Bibliothèque d'un joueur : les versions d'un même jeu forment une seule carte. */
async function listLibrary(
  filters: GameFilters,
  ownerId: string,
  where: Prisma.GameWhereInput,
  viewerId: string | null,
) {
  const rows = await db.userGame.findMany({
    where: { userId: ownerId, hidden: Boolean(filters.hidden), game: where },
    select: librarySelect,
  });
  const search = filters.q?.toLowerCase();
  const started = ownerId === viewerId ? await seasonStartedGames(ownerId) : new Set<string>();
  const startedSlugs = new Set(
    rows.filter((row) => started.has(row.game.id)).map((row) => row.game.slug),
  );
  // Le niveau dépend de toutes les versions : la plateforme se filtre une fois les cartes réunies.
  const cards = groupLibrary(rows)
    .map((card) => ({
      ...card,
      // Seule une version commencée rapporte des points : il faut qu'il lui reste des succès.
      seasonEligible: card.versions.some(
        (version) => version.completion < 100 && startedSlugs.has(version.slug),
      ),
    }))
    .filter(
      (card) =>
        (!search || card.versions.some((v) => v.name.toLowerCase().includes(search))) &&
        (!filters.platform ||
          card.versions.some(
            (v) =>
              v.platform === filters.platform &&
              (!filters.consoles ||
                consolesOf(v.console).some((name) => filters.consoles?.includes(name))),
          )) &&
        (!filters.tier || card.tier === filters.tier) &&
        (!filters.seasonOnly || card.seasonEligible) &&
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
    if (filters.sort === 'rarete') {
      // La carte à gagner d'abord, puis celle qui est le plus près d'être finie.
      return b.target - a.target || shownProgress(b) - shownProgress(a) || byName(a, b);
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
  const where: Prisma.GameWhereInput = visibleGames(filters.showAdult);
  if (filters.ownerId) return listLibrary(filters, filters.ownerId, where, viewerId);
  if (filters.q) where.name = { contains: filters.q, mode: 'insensitive' };
  if (filters.platform) where.platform = filters.platform;
  if (filters.consoles) {
    where.AND = [{ OR: filters.consoles.map((name) => ({ console: { contains: name } })) }];
  }

  // L'identifiant départage les égalités : sans lui, un jeu pourrait passer d'une page à l'autre.
  const orderBy: Prisma.GameOrderByWithRelationInput[] = [
    filters.sort === 'succes'
      ? { totalAchievements: 'desc' }
      : filters.sort === 'recent'
        ? { updatedAt: 'desc' }
        : filters.sort === 'rarete'
          ? { tier: { sort: 'desc', nulls: 'last' } }
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
        tier: true,
      },
    }),
    db.game.count({ where }),
  ]);
  const items = await withProgress(games, viewerId);
  return {
    games: items.map((game) => ({
      ...game,
      versions: [],
      tier: game.tier ?? 1,
      target: game.tier ?? 1,
      copies: 1,
      next: null,
      seasonEligible: false,
    })),
    total,
  };
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
      tier: true,
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
      game: showAdult ? {} : publicGames,
      lastUnlockedAt: { not: null },
    },
    orderBy: { lastUnlockedAt: 'desc' },
    take: limit,
    select: {
      lastUnlockedAt: true,
      user: {
        select: publicUser,
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

/** Une Légendaire pèse 27 cartes Or. Les exemplaires ne comptent pas : racheter un jeu ne rapporte rien. */
const TIER_POINTS = [25, 50, 100, 300, 900, 2700];

/** Les seuls points du site : ceux des succès ne seraient pas comparables d'une plateforme à l'autre. */
const cardScore = (tiers: number[]) =>
  tiers.reduce((sum, count, index) => sum + count * (TIER_POINTS[index] ?? 0), 0);

type TierCounts = Record<'t1' | 't2' | 't3' | 't4' | 't5' | 't6', bigint>;

/** Nombre de cartes par niveau, du Bronze au Légendaire. */
const tierCounts = (row?: TierCounts) =>
  TIERS.map((tier) => Number(row?.[`t${tier}` as keyof TierCounts] ?? 0));

const BARELY_PLAYED_MINUTES = 60;

/** Un jeu lancé à peine une heure et jamais terminé, tiré au hasard. */
export async function barelyPlayedGame(userId: string, showAdult = false) {
  const games = await db.userGame.findMany({
    where: {
      userId,
      hidden: false,
      completion: { lt: 100 },
      playtimeMinutes: { gt: 0, lt: BARELY_PLAYED_MINUTES },
      game: { ...visibleGames(showAdult), headerUrl: { not: null } },
    },
    select: {
      playtimeMinutes: true,
      game: { select: { name: true, slug: true, headerUrl: true } },
    },
    take: 20,
  });
  const picked = games[Math.floor(Math.random() * games.length)];
  if (!picked?.game.headerUrl) return null;
  const { name, slug, headerUrl } = picked.game;
  return { name, slug, headerUrl, minutes: picked.playtimeMinutes };
}

export const MAX_SHOWCASE = 8;

/** Jeux du joueur qui compteront : ceux où il a un succès d'avant la saison. */
export async function seasonStartedGames(userId: string, season = SEASON) {
  if (seasonState(season) === 'ended') return new Set<string>();
  const rows = await db.achievement.findMany({
    where: { unlocks: { some: { userId, unlockedAt: { lt: season.startsAt } } } },
    distinct: ['gameId'],
    select: { gameId: true },
  });
  return new Set(rows.map((row) => row.gameId));
}

/**
 * Les cartes obtenues par le joueur, les plus avancées d'abord.
 * Les versions inachevées restent lues : elles disent où en est le niveau suivant.
 */
export async function userCards(userId: string, showAdult = false) {
  return bestCards(await visibleLibrary(userId, showAdult));
}

async function visibleLibrary(userId: string, showAdult: boolean) {
  const rows = await db.userGame.findMany({
    where: { userId, hidden: false, game: visibleGames(showAdult) },
    orderBy: [{ lastUnlockedAt: { sort: 'desc', nulls: 'last' } }],
    select: librarySelect,
  });
  return groupLibrary(rows);
}

const bestCards = (library: LibraryCard[]) =>
  library.filter((card) => card.tier > 0).sort((a, b) => tierProgress(b) - tierProgress(a));

/** Retrouve les cartes choisies : une carte réunit toutes les versions d'un jeu. */
export const chosenCards = (cards: LibraryCard[], slugs: string[]) => [
  ...new Set(
    slugs.flatMap(
      (slug) => cards.find((card) => card.versions.some((version) => version.slug === slug)) ?? [],
    ),
  ),
];

/** Une rafale ne prouve pas une partie jouée pendant la saison : elle ne rapporte rien. */
function seasonUnlocks({ startsAt, endsAt, burstPerSecond, burstPerMinute }: Season) {
  return Prisma.sql`
    SELECT ua."userId", a."gameId", a."globalRarity",
           count(*) OVER (
             PARTITION BY ua."userId", a."gameId", date_trunc('second', ua."unlockedAt")
           ) >= ${burstPerSecond}::int
           OR count(*) OVER (
             PARTITION BY ua."userId", a."gameId", date_trunc('minute', ua."unlockedAt")
           ) >= ${burstPerMinute}::int AS burst
    FROM "UserAchievement" ua
    JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE ua."unlockedAt" >= ${startsAt} AND ua."unlockedAt" < ${endsAt}`;
}

/** Points de saison : seuls comptent les jeux déjà commencés avant son ouverture. */
export async function seasonStats(season: Season) {
  const { startsAt, endsAt, completionBonus } = season;
  const ranking = await db.$queryRaw<
    {
      id: string;
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      isPublic: boolean;
      points: bigint;
      ignored: bigint;
    }[]
  >`
    WITH unlocks AS (${seasonUnlocks(season)}), started AS (
      SELECT DISTINCT ua."userId", a."gameId"
      FROM "UserAchievement" ua
      JOIN "Achievement" a ON a.id = ua."achievementId"
      WHERE ua."unlockedAt" < ${startsAt}
    ), earned AS (
      SELECT u."userId",
             coalesce(sum(CASE
               WHEN u."globalRarity" IS NULL THEN ${RARITY_POINTS.uncommon}::int
               WHEN u."globalRarity" > 50 THEN ${RARITY_POINTS.common}::int
               WHEN u."globalRarity" >= 20 THEN ${RARITY_POINTS.uncommon}::int
               WHEN u."globalRarity" >= 5 THEN ${RARITY_POINTS.rare}::int
               ELSE ${RARITY_POINTS.epic}::int
             END) FILTER (WHERE NOT u.burst), 0) AS points,
             count(*) FILTER (WHERE u.burst) AS ignored
      FROM unlocks u
      JOIN started s ON s."userId" = u."userId" AND s."gameId" = u."gameId"
      GROUP BY 1
    ), finished AS (
      SELECT ug."userId", count(*) * ${completionBonus}::int AS points
      FROM "UserGame" ug
      JOIN started s ON s."userId" = ug."userId" AND s."gameId" = ug."gameId"
      WHERE ug.completion >= 100
        AND ug."lastUnlockedAt" >= ${startsAt} AND ug."lastUnlockedAt" < ${endsAt}
        AND NOT EXISTS (
          SELECT 1 FROM unlocks b
          WHERE b."userId" = ug."userId" AND b."gameId" = ug."gameId" AND b.burst
        )
      GROUP BY 1
    )
    SELECT u.id, u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame,
           u."frameMotionUrl", u."isPublic",
           (coalesce(e.points, 0) + coalesce(f.points, 0))::bigint AS points,
           coalesce(e.ignored, 0)::bigint AS ignored
    FROM earned e
    FULL JOIN finished f USING ("userId")
    JOIN "User" u ON u.id = "userId"
    ORDER BY points DESC, u.handle`;

  const [{ unlocked } = { unlocked: 0n }] = await db.$queryRaw<{ unlocked: bigint }[]>`
    WITH unlocks AS (${seasonUnlocks(season)})
    SELECT count(*) AS unlocked
    FROM unlocks ua
    JOIN "User" u ON u.id = ua."userId" AND u."isPublic"
    WHERE NOT ua.burst`;

  return {
    unlocked: Number(unlocked),
    ranking: ranking.map((row) => ({
      ...row,
      points: Number(row.points),
      ignored: Number(row.ignored),
    })),
  };
}

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

export const toBanner = (game: {
  name: string;
  slug: string;
  headerUrl: string;
  completion?: number | null;
}): BannerGame => ({
  name: game.name,
  slug: game.slug,
  images: bannerImages(game.headerUrl),
  completion: game.completion ?? null,
});

/** Le jeu le plus avancé du joueur ; à défaut, ou pour un invité, un jeu au hasard. */
async function seasonBanner(userId?: string) {
  const library = userId
    ? await listGames({ sort: 'progression', page: 1, ownerId: userId, unfinished: true }, userId)
    : null;
  const closest = library?.games.find((game) => game.headerUrl);
  if (closest?.headerUrl) {
    return toBanner({
      ...closest,
      headerUrl: closest.headerUrl,
      completion: closest.next?.completion ?? closest.progress?.completion,
    });
  }

  // Un jeu pas encore classé pourrait être un jeu adulte : il ne s'affiche pas à l'accueil.
  const [random] = await db.$queryRaw<{ name: string; slug: string; headerUrl: string }[]>`
    SELECT name, slug, "headerUrl"
    FROM "Game"
    WHERE NOT "adultOnly" AND "headerUrl" IS NOT NULL AND "totalAchievements" > 0
      AND (platform <> 'STEAM' OR "contentCheckedAt" IS NOT NULL)
    ORDER BY random()
    LIMIT 1`;
  return random ? toBanner(random) : null;
}

/** Le numéro 1 du classement et le premier jeu de sa vitrine, comme sur son profil. */
async function rankingBanner(leader: Collector | undefined) {
  if (!leader) return { leader: null, game: null };
  const profile = await userProfile(leader.handle, null);
  const best = profile?.showcase.find((game) => game.headerUrl);
  return {
    leader,
    game: best?.headerUrl ? toBanner({ ...best, headerUrl: best.headerUrl }) : null,
  };
}

export async function homeBanners(firstCollector: Collector | undefined, userId?: string) {
  const [season, { leader, game }] = await Promise.all([
    seasonBanner(userId),
    rankingBanner(firstCollector),
  ]);
  return { season, ranking: game, leader };
}

export async function userStats(userId: string) {
  const [collection, unlocked] = await Promise.all([
    db.$queryRaw<(TierCounts & { games: bigint })[]>`
      SELECT count(*) AS games,
             count(*) FILTER (WHERE tier = 1) AS t1,
             count(*) FILTER (WHERE tier = 2) AS t2,
             count(*) FILTER (WHERE tier = 3) AS t3,
             count(*) FILTER (WHERE tier = 4) AS t4,
             count(*) FILTER (WHERE tier = 5) AS t5,
             count(*) FILTER (WHERE tier = 6) AS t6
      FROM (
        SELECT max(COALESCE(g.tier, 1)) FILTER (WHERE ug.completion >= 100) AS tier
        FROM "UserGame" ug
        JOIN "Game" g ON g.id = ug."gameId"
        WHERE ug."userId" = ${userId} AND NOT ug.hidden
        GROUP BY COALESCE(g."familyKey", g.id)
      ) families`,
    db.userAchievement.count({ where: { userId } }),
  ]);
  const tiers = tierCounts(collection[0]);
  return {
    games: Number(collection[0]?.games ?? 0),
    tiers,
    unlocked,
    points: cardScore(tiers),
  };
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
    visibleLibrary(user.id, showAdult),
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

export type LeaderboardPeriod = 'semaine' | 'mois' | 'tout';

const PERIOD_DAYS: Record<LeaderboardPeriod, number | null> = {
  semaine: 7,
  mois: 30,
  tout: null,
};

export async function leaderboard(period: LeaderboardPeriod, limit = 20, userIds?: string[]) {
  const days = PERIOD_DAYS[period];
  const since = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  const rows = await db.$queryRaw<
    {
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      unlocked: bigint;
    }[]
  >`
    SELECT u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame, u."frameMotionUrl",
           count(*) AS unlocked
    FROM "UserAchievement" ua
    JOIN "User" u ON u.id = ua."userId" AND u."isPublic"
    WHERE ua."unlockedAt" >= ${since}
      ${userIds ? Prisma.sql`AND u.id = ANY(${userIds}::text[])` : Prisma.empty}
    GROUP BY u.id
    ORDER BY unlocked DESC, u.handle
    LIMIT ${limit}`;
  return rows.map((row) => ({ ...row, unlocked: Number(row.unlocked) }));
}

/** Classement des collections : seules les cartes comptent, pas le nombre de succès. */
async function rankedCollectors(limit: number) {
  const rows = await db.$queryRaw<
    ({
      id: string;
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
    } & TierCounts)[]
  >`
    SELECT u.id, u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame,
           u."frameMotionUrl",
           count(*) FILTER (WHERE tier = 1) AS t1,
           count(*) FILTER (WHERE tier = 2) AS t2,
           count(*) FILTER (WHERE tier = 3) AS t3,
           count(*) FILTER (WHERE tier = 4) AS t4,
           count(*) FILTER (WHERE tier = 5) AS t5,
           count(*) FILTER (WHERE tier = 6) AS t6
    FROM (
      SELECT ug."userId", max(COALESCE(g.tier, 1)) AS tier
      FROM "UserGame" ug
      JOIN "Game" g ON g.id = ug."gameId"
      WHERE ug.completion >= 100 AND NOT ug.hidden
      GROUP BY ug."userId", COALESCE(g."familyKey", g.id)
    ) cards
    JOIN "User" u ON u.id = cards."userId" AND u."isPublic"
    GROUP BY u.id`;

  return rows
    .map(({ t1, t2, t3, t4, t5, t6, ...user }) => {
      const tiers = tierCounts({ t1, t2, t3, t4, t5, t6 });
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

export async function collectors(limit = 100) {
  const rows = await rankedCollectors(limit);
  return rows.map(({ id: _id, ...row }) => row);
}

/** Tout le classement, avec les identifiants : réservé à l'attribution des récompenses. */
export const allCollectors = () => rankedCollectors(Number.MAX_SAFE_INTEGER);

export type Collector = Awaited<ReturnType<typeof collectors>>[number];

interface FeedFilter {
  /** Seuls ces joueurs : les amis ou le clan. */
  userIds?: string[];
  /** Seulement les exploits : un platine ou un succès très rare. */
  feats?: boolean;
  limit?: number;
}

/** Sous ce pourcentage de joueurs, un succès mérite d'apparaître dans le fil de tout le site. */
const FEAT_RARITY = 1;

const FEAT_ACHIEVEMENT = {
  OR: [{ trophyType: 'PLATINUM' }, { globalRarity: { lt: FEAT_RARITY } }],
} satisfies Prisma.AchievementWhereInput;

/** Un jeu vient de donner un exploit à ce joueur ? Seuls les succès récents comptent. */
export async function hasRecentFeat(userId: string, gameId: string, since: Date) {
  const feats = await db.userAchievement.count({
    where: { userId, unlockedAt: { gte: since }, achievement: { gameId, ...FEAT_ACHIEVEMENT } },
  });
  return feats > 0;
}

export async function activityFeed(
  showAdult = false,
  { userIds, feats, limit = 30 }: FeedFilter = {},
) {
  if (userIds?.length === 0) return [];
  const rows = await db.userAchievement.findMany({
    where: {
      user: { isPublic: true },
      ...(userIds && { userId: { in: userIds } }),
      achievement: {
        game: showAdult ? {} : publicGames,
        ...(feats && FEAT_ACHIEVEMENT),
      },
    },
    orderBy: { unlockedAt: 'desc' },
    // De la marge : les jeux cachés par leur joueur sont retirés ensuite.
    take: limit * 3,
    select: {
      userId: true,
      unlockedAt: true,
      user: {
        select: publicUser,
      },
      achievement: {
        select: {
          id: true,
          gameId: true,
          name: true,
          iconUrl: true,
          trophyType: true,
          globalRarity: true,
          game: { select: { name: true, slug: true } },
        },
      },
    },
  });
  const hidden = await db.userGame.findMany({
    where: { hidden: true, userId: { in: [...new Set(rows.map((row) => row.userId))] } },
    select: { userId: true, gameId: true },
  });
  const secret = new Set(hidden.map((row) => `${row.userId}:${row.gameId}`));
  return rows
    .filter((row) => !secret.has(`${row.userId}:${row.achievement.gameId}`))
    .slice(0, limit)
    .map(({ userId: _userId, ...row }) => row);
}

/** Chaque plateforme terminée fait monter la carte : Or, puis Diamant, Prismatique, Légendaire. */
async function tierMoments(showAdult: boolean, limit: number) {
  const rows = await db.$queryRaw<
    {
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      name: string;
      slug: string;
      headerUrl: string | null;
      at: Date;
      copies: bigint;
      tier: number | null;
    }[]
  >`
    WITH finished AS (
      SELECT ug."userId", ug."lastUnlockedAt" AS at, g.name, g.slug, g."headerUrl", g.platform,
             g."adultOnly", g."contentCheckedAt", g.tier,
             COALESCE(g."familyKey", g.id) AS family,
             COALESCE(g.console, g.platform::text) AS edition,
             min(ug."lastUnlockedAt") OVER (
               PARTITION BY ug."userId", COALESCE(g."familyKey", g.id),
                 COALESCE(g.console, g.platform::text)
             ) AS reached
      FROM "UserGame" ug
      JOIN "Game" g ON g.id = ug."gameId"
      JOIN "User" u ON u.id = ug."userId" AND u."isPublic"
      WHERE ug.completion >= 100 AND NOT ug.hidden AND ug."lastUnlockedAt" IS NOT NULL
    ), ranked AS (
      SELECT *, dense_rank() OVER (PARTITION BY "userId", family ORDER BY reached, edition) AS copies
      FROM finished
    )
    SELECT u.handle, u."displayName", u."avatarUrl", u."avatarMotionUrl", u.frame,
           u."frameMotionUrl", r.name, r.slug, r."headerUrl", r.at, r.copies, r.tier
    FROM ranked r
    JOIN "User" u ON u.id = r."userId"
    WHERE r.at = r.reached
      AND (${showAdult} OR (NOT r."adultOnly"
        AND (r.platform <> 'STEAM' OR r."contentCheckedAt" IS NOT NULL)))
    ORDER BY r.at DESC
    LIMIT ${limit}`;
  return rows.map(({ name, slug, headerUrl, at, copies, tier, ...user }) => ({
    kind: 'card' as const,
    key: `${user.handle}-${slug}-${copies}`,
    user,
    game: { name, slug, headerUrl },
    tier: tier ?? 1,
    copies: Math.min(Number(copies), 4),
    at,
  }));
}

/** Le fil de tout le site : les cartes obtenues et les exploits, pas chaque succès. */
export async function highlights(showAdult = false, limit = 30) {
  const [cards, feats] = await Promise.all([
    tierMoments(showAdult, limit),
    activityFeed(showAdult, { feats: true, limit }),
  ]);
  return [
    ...cards,
    ...feats.map((feat) => ({
      ...feat,
      kind: 'feat' as const,
      key: `${feat.user.handle}-${feat.achievement.id}`,
      at: feat.unlockedAt,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
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
