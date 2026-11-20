import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

/** La capture jointe à une revue Steam : pour les modérateurs, et pour le joueur qui l'a envoyée. */
export const GET: RequestHandler = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) error(404, m.gone());
  const proof = await db.steamReviewProof.findUnique({
    where: { id: params.id },
    select: { userId: true, image: true, imageType: true },
  });
  if (!proof?.image || !proof.imageType) error(404, m.gone());
  if (user.role === 'USER' && proof.userId !== user.id) error(404, m.gone());
  return new Response(new Uint8Array(proof.image), {
    headers: {
      'Content-Type': proof.imageType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
};
