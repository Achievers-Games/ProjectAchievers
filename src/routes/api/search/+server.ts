import { json } from '@sveltejs/kit';
import { Prisma, type Platform } from '#prisma';
import { db } from '#lib/server/db';
import { publicUser } from '#lib/server/queries';
import { exactGameName, matchesGameName } from '#lib/server/queries/game-name';
import type { RequestHandler } from './$types';

const GAMES_SHOWN = 8;
const PLAYERS_SHOWN = 5;

export const GET: RequestHandler = async ({ url, locals }) => {
  const q = url.searchParams.get('q')?.trim().slice(0, 80);
  if (!q || q.length < 2) return json({ games: [], players: [] });
  const viewer = locals.user?.id;

  const [games, players] = await Promise.all([
    db.$queryRaw<{ name: string; slug: string; platform: Platform }[]>`
      SELECT name, slug, platform FROM "Game"
      WHERE ${matchesGameName(Prisma.sql`name`, q)}
        ${locals.user?.showAdult ? Prisma.empty : Prisma.sql`AND NOT "adultOnly"`}
      ORDER BY ${exactGameName(Prisma.sql`name`, q)} DESC, name, id
      LIMIT ${GAMES_SHOWN}
    `,
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
