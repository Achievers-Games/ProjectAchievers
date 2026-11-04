import { db } from '#lib/server/db';
import { env } from '#lib/server/env';
import type { RequestHandler } from './$types';

const CACHE_MS = 3_600_000;

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&apos;',
  '"': '&quot;',
};

const escapeXml = (value: string) =>
  value.replace(/[&<>'"]/g, (char) => XML_ENTITIES[char] ?? char);

let cache: { xml: string; at: number } | null = null;

async function sitemap() {
  const origin = env().ORIGIN;
  const [games, users, clans] = await Promise.all([
    db.game.findMany({ where: { adultOnly: false }, select: { slug: true }, take: 40_000 }),
    db.user.findMany({ where: { isPublic: true }, select: { handle: true }, take: 10_000 }),
    db.clan.findMany({ select: { slug: true }, take: 10_000 }),
  ]);
  const paths = [
    '/',
    '/jeux',
    '/communaute',
    '/clans',
    ...games.map((g) => `/jeux/${g.slug}`),
    ...users.map((u) => `/u/${u.handle}`),
    ...clans.map((c) => `/clans/${c.slug}`),
  ];
  const urls = paths.map((path) => `<url><loc>${escapeXml(origin + path)}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export const GET: RequestHandler = async () => {
  // Le plan du site change lentement : une heure de cache suffit, pour tous les visiteurs.
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { xml: await sitemap(), at: Date.now() };
  }
  return new Response(cache.xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
