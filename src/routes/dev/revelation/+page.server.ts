import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import type { Reward } from '#lib/collection';
import { db } from '#lib/server/db';
import { RARE_CARD } from '#lib/server/queries';
import type { PageServerLoad } from './$types';

/** Rejoue la révélation avec les vraies cartes du joueur. N'existe qu'avec `vite dev`. */
export const load: PageServerLoad = async ({ locals }) => {
  if (!dev) error(404, 'Page introuvable');
  if (!locals.user) redirect(303, '/connexion?retour=/dev/revelation');

  const rows = await db.userGame.findMany({
    where: { userId: locals.user.id, ...RARE_CARD },
    orderBy: { lastUnlockedAt: { sort: 'desc', nulls: 'last' } },
    take: 14,
    select: {
      unlockedCount: true,
      completion: true,
      platinum: true,
      lastUnlockedAt: true,
      game: {
        select: {
          name: true,
          slug: true,
          platform: true,
          console: true,
          headerUrl: true,
          totalAchievements: true,
          tier: true,
        },
      },
    },
  });
  const cards = rows.map(({ game, lastUnlockedAt, ...progress }): Reward => ({
    game,
    progress,
    unlockedAt: lastUnlockedAt,
    tier: game.tier ?? 1,
  }));
  return { cards };
};
