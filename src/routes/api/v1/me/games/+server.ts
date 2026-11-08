import { apiJson, listParams, parsePlatform, unknownPlatform } from '#lib/server/partner-api';
import { partnerUserGames } from '#lib/server/partner-queries';
import { meRoute } from '#lib/server/oauth-provider';
import type { RequestHandler } from './$types';

/** Ses jeux et sa progression, mêmes paramètres que la route publique. Portée `library`. */
export const GET: RequestHandler = meRoute('library', async ({ url }, userId) => {
  const filter = url.searchParams.get('platform');
  const platform = filter ? parsePlatform(filter) : null;
  if (filter && !platform) return unknownPlatform(filter);
  const list = listParams(url);
  if (list instanceof Response) return list;
  return apiJson(await partnerUserGames({ userId }, { platform, ...list }));
});
