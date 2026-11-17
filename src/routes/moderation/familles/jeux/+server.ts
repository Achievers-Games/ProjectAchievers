import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { requireModerator } from '#lib/server/moderator';
import type { RequestHandler } from './$types';

/** Les jeux à proposer pendant la saisie : tout le catalogue, jeux pour adultes compris. */
export const GET: RequestHandler = async ({ url, locals }) => {
  requireModerator(locals);
  const q = url.searchParams.get('q')?.trim().slice(0, 80);
  if (!q || q.length < 2) return json([]);
  const games = await db.game.findMany({
    where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: q }] },
    orderBy: [{ name: 'asc' }, { platform: 'asc' }],
    take: 10,
    select: { id: true, name: true, platform: true, coverUrl: true },
  });
  return json(games);
};
