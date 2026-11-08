import { Prisma, type Platform } from '#prisma';
import { db } from './db';
import { BURIED_SCORE, GUIDE_ORDER } from './guides';
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
 * Le joueur dont on parle : par son identifiant public (`handle`), il doit avoir un profil
 * public, et l'API ne rend que ce qu'un visiteur anonyme verrait. Par `userId`, c'est le
 * joueur lui-même qui a donné son accord par OAuth : son profil peut être privé. Dans les deux
 * cas, un jeu masqué ou adulte ne sort pas.
 */
export type PlayerRef = string | { userId: string };

const publicPlayer = (who: PlayerRef) =>
  db.user.findFirst({
    where: typeof who === 'string' ? { handle: who, isPublic: true } : { id: who.userId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      createdAt: true,
      isPublic: true,
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

export async function partnerUser(handle: PlayerRef) {
  const user = await publicPlayer(handle);
  if (!user) return null;
  const stats = await userStats(user.id);
  const clan = user.clanMember?.clan;
  return {
    handle: user.handle,
    displayName: user.displayName,
    // Toujours vrai par l'identifiant public ; par OAuth, le joueur peut être privé.
    isPublic: user.isPublic,
    avatarUrl: user.avatarUrl,
    url: absolute(`/u/${user.handle}`),
    cardUrl: absolute(`/u/${user.handle}/carte.svg`),
    // La même carte en PNG, pour Discord et les forums qui refusent le SVG.
    cardPngUrl: absolute(`/u/${user.handle}/carte.png`),
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
  handle: PlayerRef,
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
export async function partnerUserGame(
  handle: PlayerRef,
  platform: Platform,
  platformGameId: string,
) {
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
/** Un jeu tel qu'un partenaire le désigne : sa plateforme et son identifiant chez elle. */
export interface GameKey {
  platform: Platform;
  platformGameId: string;
}

/**
 * Sous ce nombre de joueurs à 100 %, une médiane de temps de jeu ne dit rien, et elle pourrait
 * laisser deviner le temps d'un joueur précis : on ne la donne pas.
 */
export const COMPLETION_TIME_MIN_SAMPLE = 5;

const keyOf = (key: GameKey) => `${key.platform}:${key.platformGameId}`;
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Les fiches de plusieurs jeux, avec ce qu'Achievers sait de leur 100 % : joueurs, difficulté,
 * succès manquables, guides et temps de jeu médian. Quelques requêtes pour tout le lot, quelle
 * que soit sa taille. Rend une `Map` par `PLATEFORME:identifiant` ; un jeu inconnu ou adulte
 * n'y figure pas.
 */
export async function partnerGames(keys: GameKey[]) {
  const result = new Map<string, Awaited<ReturnType<typeof gameCard>>>();
  if (keys.length === 0) return result;

  const games = await db.game.findMany({
    where: {
      ...visibleGames(false),
      OR: keys.map(({ platform, platformGameId }) => ({ platform, platformGameId })),
    },
    select: { id: true, guideReviewedAt: true, ...apiGameSelect },
  });
  if (games.length === 0) return result;
  const ids = games.map((game) => game.id);

  const shown = { gameId: { in: ids }, hidden: false, user: { isPublic: true } };
  const visibleGuide = {
    status: 'PUBLISHED',
    OR: [{ curatedKey: { not: null } }, { score: { gt: BURIED_SCORE } }],
  } satisfies Prisma.GuideWhereInput;

  const [players, completions, missables, rarest, achievementGuides, gameGuides, times] =
    await Promise.all([
      db.userGame.groupBy({ by: ['gameId'], where: shown, _count: { _all: true } }),
      db.userGame.groupBy({
        by: ['gameId'],
        where: { ...shown, completion: { gte: 100 } },
        _count: { _all: true },
      }),
      db.achievement.groupBy({
        by: ['gameId'],
        where: { gameId: { in: ids }, missable: true },
        _count: { _all: true },
      }),
      db.achievement.groupBy({
        by: ['gameId'],
        where: { gameId: { in: ids } },
        _min: { globalRarity: true },
      }),
      // Le nombre de succès couverts par au moins un guide lisible, pas le nombre de guides.
      db.$queryRaw<{ gameId: string; covered: bigint }[]>`
        SELECT a."gameId", count(DISTINCT a.id) AS covered
        FROM "Achievement" a
        JOIN "Guide" g ON g."achievementId" = a.id
        WHERE a."gameId" IN (${Prisma.join(ids)})
          AND g.status = 'PUBLISHED'
          AND (g."curatedKey" IS NOT NULL OR g.score > ${BURIED_SCORE})
        GROUP BY a."gameId"`,
      db.guide.findMany({
        where: { gameId: { in: ids }, ...visibleGuide },
        orderBy: GUIDE_ORDER,
        select: { id: true, gameId: true },
      }),
      // Une médiane sur les joueurs publics à 100 % : jamais le temps d'un joueur seul.
      db.$queryRaw<{ gameId: string; median: number; sample: bigint }[]>`
        SELECT ug."gameId",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ug."playtimeMinutes") AS median,
               count(*) AS sample
        FROM "UserGame" ug
        JOIN "User" u ON u.id = ug."userId"
        WHERE ug."gameId" IN (${Prisma.join(ids)})
          AND ug.completion >= 100 AND ug."playtimeMinutes" > 0
          AND NOT ug.hidden AND u."isPublic"
        GROUP BY ug."gameId"
        HAVING count(*) >= ${COMPLETION_TIME_MIN_SAMPLE}`,
    ]);

  const count = (rows: { gameId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.gameId, row._count._all]));
  const playerCounts = count(players);
  const completionCounts = count(completions);
  const missableCounts = count(missables);
  const rarities = new Map(rarest.map((row) => [row.gameId, row._min.globalRarity]));
  const covered = new Map(achievementGuides.map((row) => [row.gameId, Number(row.covered)]));
  const timeByGame = new Map(times.map((row) => [row.gameId, row]));
  const guidesByGame = new Map<string, string[]>();
  for (const guide of gameGuides) {
    const list = guidesByGame.get(guide.gameId!) ?? [];
    list.push(guide.id);
    guidesByGame.set(guide.gameId!, list);
  }

  for (const game of games) {
    result.set(
      keyOf(game),
      gameCard(game, {
        players: playerCounts.get(game.id) ?? 0,
        completions: completionCounts.get(game.id) ?? 0,
        missable: missableCounts.get(game.id) ?? 0,
        rarest: rarities.get(game.id) ?? null,
        covered: covered.get(game.id) ?? 0,
        gameGuides: guidesByGame.get(game.id) ?? [],
        time: timeByGame.get(game.id) ?? null,
      }),
    );
  }
  return result;
}

function gameCard(
  game: Parameters<typeof apiGame>[0] & { guideReviewedAt: Date | null },
  stats: {
    players: number;
    completions: number;
    missable: number;
    rarest: number | null;
    covered: number;
    gameGuides: string[];
    time: { median: number; sample: bigint } | null;
  },
) {
  const [bestGuide] = stats.gameGuides;
  return {
    ...apiGame(game),
    players: stats.players,
    completions: stats.completions,
    completionRate: stats.players ? round1((stats.completions / stats.players) * 100) : null,
    difficulty: {
      missableAchievements: stats.missable,
      // Vrai quand un guide officiel a relevé tous les manquables : le compte est alors complet.
      missablesReviewed: game.guideReviewedAt !== null,
      rarestAchievement: stats.rarest,
    },
    guides: {
      achievementsCovered: stats.covered,
      gameGuides: stats.gameGuides.length,
      bestGameGuideUrl: bestGuide ? absolute(`/jeux/${game.slug}/guides/${bestGuide}`) : null,
    },
    completionTime: stats.time
      ? { medianMinutes: Math.round(stats.time.median), sample: Number(stats.time.sample) }
      : null,
  };
}

/** Un seul jeu à partir de son identifiant de plateforme, l'appid Steam par exemple. */
export async function partnerGame(platform: Platform, platformGameId: string) {
  const games = await partnerGames([{ platform, platformGameId }]);
  return games.get(keyOf({ platform, platformGameId })) ?? null;
}

export const ALMOST_LIMIT = 10;
export const ALMOST_MAX = 50;

/**
 * « Finis-le ce soir » : les jeux commencés d'un joueur public, du plus proche du 100 % au plus
 * lointain. Pour chacun, ce qui reste : combien de succès, le plus rare et le plus courant,
 * combien sont manquables. Les noms des succès restants ne sortent pas : un secret reste secret.
 */
export async function partnerAlmost(handle: PlayerRef, limit = ALMOST_LIMIT) {
  const user = await publicPlayer(handle);
  if (!user) return null;

  const rows = await db.$queryRaw<
    {
      gameId: string;
      remaining: bigint;
      hardest: number | null;
      easiest: number | null;
      missable: bigint;
      points: bigint | null;
    }[]
  >`
    SELECT ug."gameId",
           count(a.id) AS remaining,
           min(a."globalRarity") AS hardest,
           max(a."globalRarity") AS easiest,
           count(*) FILTER (WHERE a.missable) AS missable,
           sum(a.points) AS points
    FROM "UserGame" ug
    JOIN "Game" g ON g.id = ug."gameId"
    JOIN "Achievement" a ON a."gameId" = ug."gameId"
    LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = ug."userId"
    WHERE ug."userId" = ${user.id}
      AND NOT ug.hidden AND NOT g."adultOnly"
      AND ug.completion > 0 AND ug.completion < 100
      AND ua."userId" IS NULL
    GROUP BY ug."gameId"
    ORDER BY remaining ASC, hardest DESC NULLS LAST, ug."gameId" ASC
    LIMIT ${limit}`;
  if (rows.length === 0) return { items: [] };

  const games = await db.userGame.findMany({
    where: { userId: user.id, gameId: { in: rows.map((row) => row.gameId) } },
    select: { gameId: true, ...progressSelect, game: { select: apiGameSelect } },
  });
  const byGame = new Map(games.map((row) => [row.gameId, row]));
  return {
    items: rows.flatMap((row) => {
      const owned = byGame.get(row.gameId);
      if (!owned) return [];
      return [
        {
          game: apiGame(owned.game),
          progress: progress(owned),
          remaining: {
            achievements: Number(row.remaining),
            // Le plus rare des succès restants : c'est lui qui dit si le 100 % est à portée.
            hardestRarity: row.hardest,
            easiestRarity: row.easiest,
            missable: Number(row.missable),
            points: Number(row.points ?? 0),
          },
        },
      ];
    }),
  };
}

export const POPULAR_LIMIT = 20;
export const POPULAR_MAX = 50;
export const POPULAR_PERIODS = { week: 7, month: 30 } as const;
export type PopularPeriod = keyof typeof POPULAR_PERIODS;

/**
 * Les jeux qui animent les chasseurs de succès : le plus de 100 % atteints sur la période, puis
 * le plus de joueurs actifs. Seuls comptent les profils publics et les jeux montrables à tous.
 */
export async function partnerPopularGames(
  period: PopularPeriod,
  limit = POPULAR_LIMIT,
  now = new Date(),
) {
  const since = new Date(now.getTime() - POPULAR_PERIODS[period] * 24 * 60 * 60 * 1000);
  const rows = await db.$queryRaw<
    { platform: Platform; platformGameId: string; completions: bigint; active: bigint }[]
  >`
    SELECT g.platform, g."platformGameId",
           count(*) FILTER (WHERE ug.completion >= 100) AS completions,
           count(*) AS active
    FROM "UserGame" ug
    JOIN "User" u ON u.id = ug."userId"
    JOIN "Game" g ON g.id = ug."gameId"
    WHERE u."isPublic" AND NOT ug.hidden
      AND ug."lastUnlockedAt" >= ${since}
      AND NOT g."adultOnly"
      AND (g.platform <> 'STEAM' OR g."contentCheckedAt" IS NOT NULL)
    GROUP BY g.id, g.platform, g."platformGameId"
    ORDER BY completions DESC, active DESC, g."platformGameId" ASC
    LIMIT ${limit}`;

  const cards = await partnerGames(rows);
  return {
    period,
    since: since.toISOString(),
    items: rows.flatMap((row) => {
      const card = cards.get(keyOf(row));
      return card
        ? [
            {
              game: card,
              // Sur la période : 100 % atteints (dernier succès dedans) et joueurs actifs.
              periodCompletions: Number(row.completions),
              activePlayers: Number(row.active),
            },
          ]
        : [];
    }),
  };
}
