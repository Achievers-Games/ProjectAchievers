import { Prisma, type Platform } from '#prisma';
import { TIERS } from '#lib/collection';
import type { LibraryCard } from '../library';

export const PAGE_SIZE = 36;
export const MAX_SHOWCASE = 8;

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

/** Les cartes d'un joueur : la bibliothèque les regroupe, un profil les range par date. */
export const cardSelect = {
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
      console: true,
      coverUrl: true,
      headerUrl: true,
      totalAchievements: true,
      familyKey: true,
      tier: true,
    },
  },
} satisfies Prisma.UserGameSelect;

/** Position sur l'échelle : une carte Or à 58 % de son exemplaire suivant vaut 3,58. */
export const tierProgress = (card: LibraryCard) =>
  card.tier
    ? card.tier * 10 + card.copies + (card.next?.completion ?? 0) / 100
    : card.progress.completion / 100;

/** Une Légendaire pèse 27 cartes Or. Les exemplaires ne comptent pas : racheter un jeu ne rapporte rien. */
export const TIER_POINTS = [25, 50, 100, 300, 900, 2700];

/** Les seuls points du site : ceux des succès ne seraient pas comparables d'une plateforme à l'autre. */
export const cardScore = (tiers: number[]) =>
  tiers.reduce((sum, count, index) => sum + count * (TIER_POINTS[index] ?? 0), 0);

export type TierCounts = Record<'t1' | 't2' | 't3' | 't4' | 't5' | 't6', bigint>;

/** Nombre de cartes par niveau, du Bronze au Légendaire. */
export const tierCounts = (row?: TierCounts) =>
  TIERS.map((tier) => Number(row?.[`t${tier}` as keyof TierCounts] ?? 0));
