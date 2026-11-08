import { apiError, apiJson } from '#lib/server/partner-api';
import { ALMOST_LIMIT, ALMOST_MAX, partnerAlmost } from '#lib/server/partner-queries';
import { meRoute } from '#lib/server/oauth-provider';
import type { RequestHandler } from './$types';

/** Ses jeux commencés les plus proches du 100 %. Portée `library`. */
export const GET: RequestHandler = meRoute('library', async ({ url }, userId) => {
  const raw = url.searchParams.get('limit');
  const limit = raw === null ? ALMOST_LIMIT : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > ALMOST_MAX) {
    return apiError(400, 'bad_request', `limit must be a whole number from 1 to ${ALMOST_MAX}.`);
  }
  return apiJson(await partnerAlmost({ userId }, limit));
});
