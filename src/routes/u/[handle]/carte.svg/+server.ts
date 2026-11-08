import { error } from '@sveltejs/kit';
import { cardHeaders, playerCardSvg } from '#lib/server/player-card';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const svg = await playerCardSvg(params.handle);
  if (!svg) error(404, m.profile_not_found());

  return new Response(svg, {
    headers: {
      ...cardHeaders('image/svg+xml; charset=utf-8'),
      // Ouverte seule, l'image ne doit rien pouvoir exécuter ni charger.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    },
  });
};
