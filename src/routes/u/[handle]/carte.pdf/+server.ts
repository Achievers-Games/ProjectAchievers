import { error } from '@sveltejs/kit';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardHeaders,
  playerCardData,
  renderPlayerCard,
} from '#lib/server/player-card';
import { svgToPdf } from '#lib/server/player-card-pdf';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

/** La carte en PDF, à imprimer ou à garder : le lien la télécharge plutôt que de l'ouvrir. */
export const GET: RequestHandler = async ({ params }) => {
  const card = await playerCardData(params.handle);
  if (!card) error(404, m.profile_not_found());

  const pdf = await svgToPdf(
    renderPlayerCard(card),
    { width: CARD_WIDTH, height: CARD_HEIGHT },
    m.player_card_alt({ name: card.displayName }),
  );
  return new Response(pdf, {
    headers: {
      ...cardHeaders('application/pdf'),
      'Content-Disposition': `attachment; filename="achievers-${card.handle}.pdf"`,
    },
  });
};
