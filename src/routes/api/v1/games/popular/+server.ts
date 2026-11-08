import { apiError, apiJson, partnerRoute } from '#lib/server/partner-api';
import {
  POPULAR_LIMIT,
  POPULAR_MAX,
  POPULAR_PERIODS,
  partnerPopularGames,
  type PopularPeriod,
} from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

/** `/games/popular?period=week` : les jeux où les chasseurs de succès sont actifs. */
export const GET: RequestHandler = partnerRoute(async ({ url }) => {
  const period = (url.searchParams.get('period') ?? 'week') as PopularPeriod;
  if (!(period in POPULAR_PERIODS)) {
    return apiError(
      400,
      'bad_request',
      `period must be one of: ${Object.keys(POPULAR_PERIODS).join(', ')}.`,
    );
  }
  const raw = url.searchParams.get('limit');
  const limit = raw === null ? POPULAR_LIMIT : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > POPULAR_MAX) {
    return apiError(400, 'bad_request', `limit must be a whole number from 1 to ${POPULAR_MAX}.`);
  }
  return apiJson(await partnerPopularGames(period, limit));
});
