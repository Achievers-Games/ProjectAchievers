import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { visibleGames } from '#lib/server/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const q = url.searchParams.get('q')?.trim().slice(0, 80);
  if (!q || q.length < 2) return json([]);

  const games = await db.game.findMany({
    where: { ...visibleGames(locals.user?.showAdult), name: { contains: q, mode: 'insensitive' } },
    orderBy: { name: 'asc' },
    take: 8,
    select: { name: true, slug: true, platform: true },
  });
  return json(games);
};
