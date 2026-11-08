import { apiJson, notFound, parsePlatform, unknownPlatform } from '#lib/server/partner-api';
import { partnerUserGame } from '#lib/server/partner-queries';
import { meRoute } from '#lib/server/oauth-provider';
import type { RequestHandler } from './$types';

/** Sa progression sur un jeu, succès par succès. Portée `achievements`. */
export const GET: RequestHandler = meRoute('achievements', async ({ params }, userId) => {
  const platform = parsePlatform(params.platform);
  if (!platform) return unknownPlatform(params.platform);
  const game = await partnerUserGame({ userId }, platform, params.id);
  return game ? apiJson(game) : notFound('Game in this library');
});
