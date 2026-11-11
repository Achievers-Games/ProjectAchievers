import { error } from '@sveltejs/kit';
import {
  SHARE_WIDTH,
  cardHeaders,
  playerCardData,
  renderShareImage,
} from '#lib/server/player-card';
import { svgToPng } from '#lib/server/player-card-png';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

/** L'aperçu d'un lien de profil, lu par Discord, X, Reddit et les moteurs de recherche. */
export const GET: RequestHandler = async ({ params }) => {
  const card = await playerCardData(params.handle);
  if (!card) error(404, m.profile_not_found());

  const png = await svgToPng(renderShareImage(card), SHARE_WIDTH, 1);
  return new Response(png, { headers: cardHeaders('image/png') });
};
