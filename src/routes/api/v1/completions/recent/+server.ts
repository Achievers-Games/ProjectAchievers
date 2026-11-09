import { apiError, apiJson, partnerRoute } from '#lib/server/partner-api';
import { RECENT_LIMIT, RECENT_MAX, partnerRecentCompletions } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

/** `/completions/recent?limit=20&since=…` : les derniers 100 % des joueurs publics. */
export const GET: RequestHandler = partnerRoute(async ({ url }) => {
  const raw = url.searchParams.get('limit');
  const limit = raw === null ? RECENT_LIMIT : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > RECENT_MAX) {
    return apiError(400, 'bad_request', `limit must be a whole number from 1 to ${RECENT_MAX}.`);
  }
  const rawSince = url.searchParams.get('since');
  const since = rawSince === null ? null : new Date(rawSince);
  if (since && Number.isNaN(since.getTime())) {
    return apiError(400, 'bad_request', 'since must be an ISO 8601 date.');
  }
  return apiJson(await partnerRecentCompletions(limit, since));
});
