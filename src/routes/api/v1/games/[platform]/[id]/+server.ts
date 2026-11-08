import {
  apiJson,
  notFound,
  parsePlatform,
  partnerRoute,
  unknownPlatform,
} from '#lib/server/partner-api';
import { partnerGame } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

/** `/api/v1/games/steam/683320` : la fiche Achievers d'un jeu à partir de son appid Steam. */
export const GET: RequestHandler = partnerRoute(async ({ params }) => {
  const platform = parsePlatform(params.platform);
  if (!platform) return unknownPlatform(params.platform);

  const game = await partnerGame(platform, params.id);
  return game ? apiJson(game) : notFound('Game');
});
