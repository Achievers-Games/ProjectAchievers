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

/** Les paramètres de `/jeux` qui multiplient les adresses sans rien apporter aux moteurs. */
const JEUX_FILTERS = ['joueur', 'plateforme', 'filtre', 'tri', 'vue', 'q'];

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
      // Les filtres de la liste des jeux se combinent à l'infini : Google en a exploré des milliers,
      // vides pour la plupart (soft 404). Le niveau et la pagination restent ouverts.
      ...JEUX_FILTERS.flatMap((key) => [`Disallow: /jeux?*${key}=`, `Disallow: /*/jeux?*${key}=`]),
      '',
      `Sitemap: ${env().ORIGIN}/sitemap.xml`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' } },
  );
