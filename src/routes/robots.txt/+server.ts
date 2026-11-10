import { env } from '#lib/server/env';
import type { RequestHandler } from './$types';

/** Servi par le site pour pointer le plan du site sur l'adresse publique, quelle qu'elle soit. */
export const GET: RequestHandler = () =>
  new Response(
    [
      'User-agent: *',
      'Disallow: /compte',
      'Disallow: /moderation',
      'Disallow: /auth/',
      'Disallow: /api/',
      '',
      `Sitemap: ${env().ORIGIN}/sitemap.xml`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' } },
  );
