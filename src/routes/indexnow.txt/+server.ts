import { error } from '@sveltejs/kit';
import { indexNowEnabled, indexNowKey } from '#lib/server/indexnow';
import type { RequestHandler } from './$types';

/** Le fichier de clé IndexNow : Bing le lit pour vérifier que les annonces viennent du site. */
export const GET: RequestHandler = () => {
  if (!indexNowEnabled()) error(404);
  return new Response(indexNowKey(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
