import { apiError, apiJson, notFound, partnerRoute } from '#lib/server/partner-api';
import { ALMOST_LIMIT, ALMOST_MAX, partnerAlmost } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

/** `/users/{handle}/almost` : les jeux commencés les plus proches du 100 %. */
export const GET: RequestHandler = partnerRoute(async ({ params, url }) => {
  const raw = url.searchParams.get('limit');
  const limit = raw === null ? ALMOST_LIMIT : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > ALMOST_MAX) {
    return apiError(400, 'bad_request', `limit must be a whole number from 1 to ${ALMOST_MAX}.`);
  }
  const almost = await partnerAlmost(params.handle, limit);
  return almost ? apiJson(almost) : notFound('Public profile');
});
