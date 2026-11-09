import {
  apiJson,
  notFound,
  parsePlatform,
  partnerRoute,
  unknownPlatform,
} from '#lib/server/partner-api';
import { partnerGameAchievements } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

/** Les succès d'un jeu sans joueur : les plus rares d'abord, avec le lien de leurs guides. */
export const GET: RequestHandler = partnerRoute(async ({ params }) => {
  const platform = parsePlatform(params.platform);
  if (!platform) return unknownPlatform(params.platform);
  const game = await partnerGameAchievements(platform, params.id);
  return game ? apiJson(game) : notFound('Game');
});
