import { env } from '#lib/server/env';
import type { RequestHandler } from './$types';

const UNWANTED = [
  'Amazonbot',
  'SemrushBot',
  'MJ12bot',
  'SERankingBacklinksBot',
  'Reflectionbot',
  'AhrefsBot',
  'DotBot',
  'PetalBot',
];

/** Servi par le site pour pointer le plan du site sur l'adresse publique, quelle qu'elle soit. */
export const GET: RequestHandler = () =>
  new Response(
    [
      // Robots SEO et de collecte pour l'IA : les deux tiers du trafic, sans visiteur en retour.
      ...UNWANTED.flatMap((bot) => [`User-agent: ${bot}`, 'Disallow: /', '']),
      'User-agent: *',
      'Disallow: /compte',
      'Disallow: /moderation',
      'Disallow: /auth/',
      // D'anciens liens y menaient : Google les a indexées sans pouvoir les lire. Ouvertes, il y voit
      // le `noindex` posé par `hooks.server.ts` et les retire. La règle la plus longue l'emporte.
      'Allow: /auth/*/start',
      'Disallow: /api/',
      // Chaque page de succès y renvoie avec son adresse : une page de connexion par succès et
      // par langue, que les robots suivaient par milliers. Seule l'adresse nue reste ouverte :
      // Google l'a indexée, et doit pouvoir y lire le `noindex` pour la retirer.
      'Disallow: /connexion',
      'Disallow: /*/connexion',
      'Allow: /connexion$',
      'Allow: /*/connexion$',
      '',
      `Sitemap: ${env().ORIGIN}/sitemap.xml`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' } },
  );
