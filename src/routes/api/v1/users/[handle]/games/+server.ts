import {
  apiJson,
  listParams,
  notFound,
  parsePlatform,
  partnerRoute,
  unknownPlatform,
} from '#lib/server/partner-api';
import { partnerUserGames } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = partnerRoute(async ({ params, url }) => {
  const filter = url.searchParams.get('platform');
  const platform = filter ? parsePlatform(filter) : null;
  if (filter && !platform) return unknownPlatform(filter);

  const list = listParams(url);
  if (list instanceof Response) return list;

  const games = await partnerUserGames(params.handle, { platform, ...list });
  return games ? apiJson(games) : notFound('Public profile');
});
