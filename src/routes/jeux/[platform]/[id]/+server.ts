import { error, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { parsePlatform } from '#lib/server/partner-api';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

/**
 * `/jeux/steam/683320` mène à la fiche du jeu : un site partenaire (Lure) fait un lien avec
 * l'appid qu'il connaît déjà, sans connaître nos adresses. La fiche garde son adresse lisible.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const platform = parsePlatform(params.platform);
  if (!platform) error(404, m.not_found());

  const game = await db.game.findUnique({
    where: { platform_platformGameId: { platform, platformGameId: params.id } },
    select: { slug: true },
  });
  if (!game) error(404, m.not_found());

  // Le slug peut changer : la redirection reste temporaire pour ne pas se figer en cache.
  redirect(307, `/jeux/${game.slug}${url.search}`);
};
