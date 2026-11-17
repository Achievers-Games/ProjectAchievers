import { json } from '@sveltejs/kit';
import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import { appearanceGames } from '#lib/server/appearance-games';
import type { RequestHandler } from './$types';

/** Les pages suivantes de la grille de /compte/fond, lues en approchant du bas. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireLogin(locals, '/compte/fond');
  const target = url.searchParams.get('cible') === 'fond' ? 'fond' : 'banniere';
  const q = url.searchParams.get('q')?.trim().slice(0, 80) || '';
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  // Le jeu choisi garde sa version dans sa famille, comme sur la première page.
  const profile = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { bannerGameId: true, backgroundGameId: true },
  });
  const chosen = target === 'fond' ? profile.backgroundGameId : profile.bannerGameId;
  return json(await appearanceGames(user.id, target, { q, chosen, page }));
};
