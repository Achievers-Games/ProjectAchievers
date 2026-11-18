import { db } from './db';
import { onePerFamily } from './queries';

/** Une page de la grille : la page suivante se charge en approchant du bas. */
export const APPEARANCE_PAGE = 48;

export type AppearanceTarget = 'banniere' | 'fond';

export const appearanceAsset = (target: AppearanceTarget) =>
  target === 'banniere' ? 'heroUrl' : 'artUrl';

export const appearanceEligibility = (target: AppearanceTarget) => ({
  headerUrl: { not: null },
  [appearanceAsset(target)]: { not: null, notIn: [''] },
});

/**
 * Les jeux qui peuvent habiller la bannière ou le fond, une version par famille, les plus
 * récemment joués devant. Toute la bibliothèque est lue (quelques milliers de lignes au plus) :
 * le regroupement par famille empêche de découper la requête elle-même en pages.
 */
export async function appearanceGames(
  userId: string,
  target: AppearanceTarget,
  { q = '', chosen = null as string | null, page = 1 } = {},
) {
  const asset = appearanceAsset(target);
  const rows = await db.userGame.findMany({
    where: {
      userId,
      hidden: false,
      game: {
        ...appearanceEligibility(target),
        ...(q && { name: { contains: q, mode: 'insensitive' } }),
      },
    },
    orderBy: [{ lastPlayedAt: { sort: 'desc', nulls: 'last' } }, { game: { name: 'asc' } }],
    select: {
      game: {
        select: {
          id: true,
          name: true,
          slug: true,
          artUrl: true,
          heroUrl: true,
          platform: true,
          familyKey: true,
        },
      },
    },
  });
  const all = onePerFamily(
    rows.map((row) => row.game),
    chosen,
  );
  const start = (Math.max(1, page) - 1) * APPEARANCE_PAGE;
  return {
    pages: Math.max(1, Math.ceil(all.length / APPEARANCE_PAGE)),
    games: all.slice(start, start + APPEARANCE_PAGE).map((game) => ({
      id: game.id,
      name: game.name,
      image: game[asset]!,
    })),
  };
}

export type AppearanceGame = Awaited<ReturnType<typeof appearanceGames>>['games'][number];
