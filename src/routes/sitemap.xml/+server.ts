import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { env } from '#lib/server/env';
import { baseLocale, locales } from '#lib/paraglide/runtime';
import { localizedPath } from '#lib/localized-path';
import type { RequestHandler } from './$types';

const CACHE_MS = 3_600_000;
/** Les moteurs refusent un plan de plus de 50 000 adresses : au-delà, un index le découpe. */
const PER_FILE = 45_000;

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&apos;',
  '"': '&quot;',
};

const escapeXml = (value: string) =>
  value.replace(/[&<>'"]/g, (char) => XML_ENTITIES[char] ?? char);

type Entry = { path: string; updated?: Date };

let cache: { entries: Entry[]; at: number; xml: Map<string, string> } | null = null;

const later = (a: Date | undefined, b: Date) => (a && a > b ? a : b);

async function entries(): Promise<Entry[]> {
  const [games, users, clans, guides, achievementGuides, achievements] = await Promise.all([
    db.game.findMany({
      where: { adultOnly: false },
      select: { id: true, slug: true, createdAt: true },
      take: 40_000,
    }),
    db.user.findMany({ where: { isPublic: true }, select: { handle: true }, take: 10_000 }),
    db.clan.findMany({ select: { slug: true }, take: 10_000 }),
    db.guide.findMany({
      where: { status: 'PUBLISHED', game: { adultOnly: false } },
      select: { id: true, updatedAt: true, gameId: true, game: { select: { slug: true } } },
      take: 20_000,
    }),
    db.guide.findMany({
      where: { status: 'PUBLISHED', achievement: { game: { adultOnly: false } } },
      select: { updatedAt: true, achievementId: true, achievement: { select: { gameId: true } } },
      take: 80_000,
    }),
    // Seuls les succès visibles qui ont un guide : une fiche vide n'apporte rien aux moteurs.
    db.achievement.findMany({
      where: {
        hidden: false,
        game: { adultOnly: false },
        guides: { some: { status: 'PUBLISHED' } },
      },
      select: { id: true },
      take: 40_000,
    }),
  ]);
  // Des dates qui ne bougent qu'avec ce que la page montre : l'apparition du jeu et ses guides.
  // `Game.updatedAt` ne convient pas, les vérifications de fond le touchent chaque jour, et un
  // `lastmod` qui change sans cesse est ignoré par Google.
  const gameUpdated = new Map<string, Date>();
  const achievementUpdated = new Map<string, Date>();
  for (const g of guides) {
    if (g.gameId) gameUpdated.set(g.gameId, later(gameUpdated.get(g.gameId), g.updatedAt));
  }
  for (const g of achievementGuides) {
    if (!g.achievementId || !g.achievement) continue;
    const { gameId } = g.achievement;
    gameUpdated.set(gameId, later(gameUpdated.get(gameId), g.updatedAt));
    achievementUpdated.set(
      g.achievementId,
      later(achievementUpdated.get(g.achievementId), g.updatedAt),
    );
  }
  return [
    ...['/', '/jeux', '/communaute', '/clans', '/classement', '/saison', '/developpeurs'].map(
      (path) => ({ path }),
    ),
    ...games.map((g) => ({
      path: `/jeux/${g.slug}`,
      updated: later(gameUpdated.get(g.id), g.createdAt),
    })),
    ...guides.flatMap((g) =>
      g.game ? [{ path: `/jeux/${g.game.slug}/guides/${g.id}`, updated: g.updatedAt }] : [],
    ),
    ...achievements.map((a) => ({
      path: `/succes/${a.id}`,
      updated: achievementUpdated.get(a.id),
    })),
    ...users.map((u) => ({ path: `/u/${u.handle}` })),
    ...clans.map((c) => ({ path: `/clans/${c.slug}` })),
  ];
}

/**
 * Chaque page une fois, à son adresse française (sans préfixe), avec ses versions dans toutes les langues
 * (hreflang) : les moteurs découvrent ainsi les huit langues sans un plan huit fois plus long.
 */
const urlset = (origin: string, list: Entry[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${list
    .map(({ path, updated }) => {
      const alternates = locales
        .map(
          (locale) =>
            `<xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(origin + localizedPath(path, locale))}"/>`,
        )
        .join('');
      const fallback = `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(origin + path)}"/>`;
      return `<url><loc>${escapeXml(origin + localizedPath(path, baseLocale))}</loc>${updated ? `<lastmod>${updated.toISOString()}</lastmod>` : ''}${alternates}${fallback}</url>`;
    })
    .join('')}</urlset>`;

const sitemapIndex = (origin: string, files: number) =>
  `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from(
    { length: files },
    (_, index) =>
      `<sitemap><loc>${escapeXml(`${origin}/sitemap.xml?page=${index + 1}`)}</loc></sitemap>`,
  ).join('')}</sitemapindex>`;

export const GET: RequestHandler = async ({ url }) => {
  // Le plan du site change lentement : une heure de cache suffit, pour tous les visiteurs.
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { entries: await entries(), at: Date.now(), xml: new Map() };
  }
  const origin = env().ORIGIN;
  const files = Math.ceil(cache.entries.length / PER_FILE);
  const asked = url.searchParams.get('page');

  // Le XML aussi est gardé l'heure durant : le reconstruire à chaque passage de robot coûte cher.
  let xml = cache.xml.get(asked ?? '');
  if (!xml) {
    if (asked === null) {
      xml = files > 1 ? sitemapIndex(origin, files) : urlset(origin, cache.entries);
    } else {
      const index = Number(asked);
      if (!Number.isInteger(index) || index < 1 || index > files) error(404);
      xml = urlset(origin, cache.entries.slice((index - 1) * PER_FILE, index * PER_FILE));
    }
    cache.xml.set(asked ?? '', xml);
  }
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
