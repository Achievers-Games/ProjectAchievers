import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { publicUser, visibleGames } from '#lib/server/queries';
import type { RequestHandler } from './$types';

const GAMES_SHOWN = 8;
const PLAYERS_SHOWN = 5;

export const GET: RequestHandler = async ({ url, locals }) => {
  const q = url.searchParams.get('q')?.trim().slice(0, 80);
  if (!q || q.length < 2) return json({ games: [], players: [] });
  const viewer = locals.user?.id;

  const [games, players] = await Promise.all([
    db.game.findMany({
      where: {
        ...visibleGames(locals.user?.showAdult),
        name: { contains: q, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: GAMES_SHOWN,
      select: { name: true, slug: true, platform: true },
    }),
    // Seuls les profils publics se trouvent, et jamais quelqu'un avec qui on s'est bloqué.
    db.user.findMany({
      where: {
        isPublic: true,
        OR: [
          { handle: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
        ...(viewer && {
          blocks: { none: { blockedId: viewer } },
          blockedBy: { none: { blockerId: viewer } },
        }),
      },
      orderBy: { displayName: 'asc' },
      take: PLAYERS_SHOWN,
      select: publicUser,
    }),
  ]);
  return json({ games, players });
};
