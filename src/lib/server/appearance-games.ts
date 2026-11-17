import { thumbArt } from '#lib/art';
import { db } from './db';
import { onePerFamily, toBanner } from './queries';

/** Une page de la grille : la page suivante se charge en approchant du bas. */
export const APPEARANCE_PAGE = 48;

export type AppearanceTarget = 'banniere' | 'fond';

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
  const rows = await db.userGame.findMany({
    where: {
      userId,
      hidden: false,
      game: {
        headerUrl: { not: null },
        // Une icône de trophée PlayStation ou Xbox étirée en fond est laide : seuls les jeux qui
        // ont une grande image se proposent (images de la boutique Steam, ou d'un jeu Steam).
        OR: [{ artUrl: { not: null } }, { heroUrl: { not: null } }, { platform: 'STEAM' }],
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
          headerUrl: true,
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
      // Chaque onglet montre l'image qu'il posera : le bandeau pour la bannière, le fond de la
      // page boutique pour le fond.
      ...toBanner(
        { ...game, headerUrl: game.headerUrl as string },
        target === 'banniere' ? 'banner' : 'background',
      ),
      thumb: target === 'banniere' ? null : game.artUrl ? thumbArt(game.artUrl) : null,
    })),
  };
}

export type AppearanceGame = Awaited<ReturnType<typeof appearanceGames>>['games'][number];
