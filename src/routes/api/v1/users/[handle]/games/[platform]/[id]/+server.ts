import {
  apiJson,
  notFound,
  parsePlatform,
  partnerRoute,
  unknownPlatform,
} from '#lib/server/partner-api';
import { partnerUserGame } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = partnerRoute(async ({ params }) => {
  const platform = parsePlatform(params.platform);
  if (!platform) return unknownPlatform(params.platform);

  const game = await partnerUserGame(params.handle, platform, params.id);
  return game ? apiJson(game) : notFound('Game in this public profile');
});
