import { db } from '$lib/server/db';
import { env } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const origin = env().ORIGIN;
  const [games, users] = await Promise.all([
    db.game.findMany({ select: { slug: true }, take: 40_000 }),
    db.user.findMany({ where: { isPublic: true }, select: { handle: true }, take: 10_000 }),
  ]);
  const paths = [
    '/',
    '/jeux',
    '/communaute',
    ...games.map((g) => `/jeux/${g.slug}`),
    ...users.map((u) => `/u/${u.handle}`),
  ];
  const urls = paths.map((path) => `<url><loc>${origin}${path}</loc></url>`).join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
};
