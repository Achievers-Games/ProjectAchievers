import type { Platform } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { consolesOf } from '$lib/collection';
import { db } from '../db';
import { groupLibrary, type LibraryCard } from '../library';
import { seasonStartedGames } from './stats';
import {
  PAGE_SIZE,
  cardSelect,
  isUnfinished,
  rarityOf,
  shownProgress,
  tierProgress,
  visibleGames,
} from './shared';

/**
 * - `termines` : au moins une version à 100 %, la carte est obtenue ;
 * - `restants` : il reste une version commencée à finir ;
 * - `saison` : les jeux qui rapportent des points cette saison ;
 * - `caches` : les jeux cachés par le joueur, et seulement eux.
 */
export type GameStatus = 'termines' | 'restants' | 'saison' | 'caches';

interface GameFilters {
  q?: string;
  platform?: Platform;
  /** Des consoles précises de la plateforme : PS4, ou One et Series pour Xbox. */
  consoles?: string[];
  sort: 'nom' | 'recent' | 'progression' | 'succes' | 'rarete';
  page: number;
  ownerId?: string;
  /** Avec `ownerId` : où en est le joueur sur le jeu. */
  status?: GameStatus;
  /** Rareté du jeu : la carte qu'il donne, obtenue ou non. */
  tier?: number;
  showAdult?: boolean;
}

/** Bibliothèque d'un joueur : les versions d'un même jeu forment une seule carte. */
async function listLibrary(
  filters: GameFilters,
  ownerId: string,
  where: Prisma.GameWhereInput,
  viewerId: string | null,
) {
  const rows = await db.userGame.findMany({
    where: { userId: ownerId, hidden: filters.status === 'caches', game: where },
    select: cardSelect,
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
        (!filters.tier || rarityOf(card) === filters.tier) &&
        (filters.status !== 'termines' || card.tier > 0) &&
        (filters.status !== 'restants' || isUnfinished(card)) &&
        (filters.status !== 'saison' || card.seasonEligible),
    );
  const ongoing = filters.status === 'restants' || filters.status === 'saison';

  const byName = (a: (typeof cards)[number], b: (typeof cards)[number]) =>
    a.name.localeCompare(b.name, 'fr');
  cards.sort((a, b) => {
    if (filters.sort === 'succes') {
      return b.totalAchievements - a.totalAchievements || byName(a, b);
    }
    if (filters.sort === 'progression') {
      // Parmi les jeux à finir, seul compte ce qui est presque fini.
      if (ongoing) return shownProgress(b) - shownProgress(a) || byName(a, b);
      // Les exemplaires d'abord (×4, ×3, ×2) : la rareté a son propre tri.
      return b.copies - a.copies || tierProgress(b) - tierProgress(a) || byName(a, b);
    }
    if (filters.sort === 'rarete') {
      // La carte la plus rare d'abord, puis celle qui est le plus près d'être finie.
      return rarityOf(b) - rarityOf(a) || shownProgress(b) - shownProgress(a) || byName(a, b);
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
  const and: Prisma.GameWhereInput[] = [];
  // Un jeu pas encore classé compte comme Bronze, comme sur sa carte.
  if (filters.tier)
    and.push(filters.tier === 1 ? { OR: [{ tier: 1 }, { tier: null }] } : { tier: filters.tier });
  if (filters.consoles) {
    and.push({ OR: filters.consoles.map((name) => ({ console: { contains: name } })) });
  }
  if (and.length) where.AND = and;

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
        console: true,
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

/**
 * Les cartes obtenues par le joueur, les plus avancées d'abord.
 * Les versions inachevées restent lues : elles disent où en est le niveau suivant.
 */
export async function userCards(userId: string, showAdult = false) {
  return bestCards(await visibleLibrary(userId, showAdult));
}

export async function visibleLibrary(userId: string, showAdult: boolean) {
  const rows = await db.userGame.findMany({
    where: { userId, hidden: false, game: visibleGames(showAdult) },
    orderBy: [{ lastUnlockedAt: { sort: 'desc', nulls: 'last' } }],
    select: cardSelect,
  });
  return groupLibrary(rows);
}

export const bestCards = (library: LibraryCard[]) =>
  library.filter((card) => card.tier > 0).sort((a, b) => tierProgress(b) - tierProgress(a));

/** Retrouve les cartes choisies : une carte réunit toutes les versions d'un jeu. */
export const chosenCards = (cards: LibraryCard[], slugs: string[]) => [
  ...new Set(
    slugs.flatMap(
      (slug) => cards.find((card) => card.versions.some((version) => version.slug === slug)) ?? [],
    ),
  ),
];
