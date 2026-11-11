import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { env } from '#lib/server/env';
import { baseLocale, locales, localizeUrl } from '#lib/paraglide/runtime';
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

let cache: { entries: Entry[]; at: number } | null = null;

async function entries(): Promise<Entry[]> {
  const [games, users, clans, guides, achievements] = await Promise.all([
    db.game.findMany({ where: { adultOnly: false }, select: { slug: true }, take: 40_000 }),
    db.user.findMany({ where: { isPublic: true }, select: { handle: true }, take: 10_000 }),
    db.clan.findMany({ select: { slug: true }, take: 10_000 }),
    db.guide.findMany({
      where: { status: 'PUBLISHED', game: { adultOnly: false } },
      select: { id: true, updatedAt: true, game: { select: { slug: true } } },
      take: 20_000,
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
  return [
    ...['/', '/jeux', '/communaute', '/clans', '/classement', '/saison', '/developpeurs'].map(
      (path) => ({ path }),
    ),
    ...games.map((g) => ({ path: `/jeux/${g.slug}` })),
    ...guides.flatMap((g) =>
      g.game ? [{ path: `/jeux/${g.game.slug}/guides/${g.id}`, updated: g.updatedAt }] : [],
    ),
    ...achievements.map((a) => ({ path: `/succes/${a.id}` })),
    ...users.map((u) => ({ path: `/u/${u.handle}` })),
    ...clans.map((c) => ({ path: `/clans/${c.slug}` })),
  ];
}

/** L'adresse d'une page dans une langue : /fr/…, /en/… */
const localized = (origin: string, path: string, locale: string) =>
  localizeUrl(new URL(path, origin), { locale: locale as (typeof locales)[number] }).href;

/**
 * Chaque page une fois, à son adresse française, avec ses versions dans toutes les langues
 * (hreflang) : les moteurs découvrent ainsi les huit langues sans un plan huit fois plus long.
 */
const urlset = (origin: string, list: Entry[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${list
    .map(({ path, updated }) => {
      const alternates = locales
        .map(
          (locale) =>
            `<xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(localized(origin, path, locale))}"/>`,
        )
        .join('');
      const fallback = `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(origin + path)}"/>`;
      return `<url><loc>${escapeXml(localized(origin, path, baseLocale))}</loc>${updated ? `<lastmod>${updated.toISOString()}</lastmod>` : ''}${alternates}${fallback}</url>`;
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
    cache = { entries: await entries(), at: Date.now() };
  }
  const origin = env().ORIGIN;
  const files = Math.ceil(cache.entries.length / PER_FILE);
  const asked = url.searchParams.get('page');

  let xml: string;
  if (asked === null) {
    xml = files > 1 ? sitemapIndex(origin, files) : urlset(origin, cache.entries);
  } else {
    const index = Number(asked);
    if (!Number.isInteger(index) || index < 1 || index > files) error(404);
    xml = urlset(origin, cache.entries.slice((index - 1) * PER_FILE, index * PER_FILE));
  }
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
