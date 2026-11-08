import { error } from '@sveltejs/kit';
import { CARD_WIDTH, cardHeaders, playerCardSvg } from '#lib/server/player-card';
import { svgToPng } from '#lib/server/player-card-png';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

/** La même carte en PNG : Discord et la plupart des forums n'affichent pas le SVG. */
export const GET: RequestHandler = async ({ params }) => {
  const svg = await playerCardSvg(params.handle);
  if (!svg) error(404, m.profile_not_found());

  const png = await svgToPng(svg, CARD_WIDTH);
  return new Response(png, { headers: cardHeaders('image/png') });
};
