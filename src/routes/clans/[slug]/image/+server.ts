import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { m } from '$lib/paraglide/messages';
import type { RequestHandler } from './$types';

/** L'emblème d'un clan. En attente de modération, seuls ses membres et les modérateurs le voient. */
export const GET: RequestHandler = async ({ params, locals }) => {
  const clan = await db.clan.findUnique({
    where: { slug: params.slug },
    select: { id: true, image: true, imageType: true, imagePending: true },
  });
  if (!clan?.image || !clan.imageType) error(404, m.gone());
  if (clan.imagePending) {
    const user = locals.user;
    const member =
      user &&
      (user.role !== 'USER' ||
        (await db.clanMember.count({ where: { userId: user.id, clanId: clan.id } })) > 0);
    if (!member) error(404, m.gone());
  }
  return new Response(new Uint8Array(clan.image), {
    headers: {
      'Content-Type': clan.imageType,
      'X-Content-Type-Options': 'nosniff',
      // L'adresse change à chaque nouvel emblème : la version publiée ne bouge plus.
      'Cache-Control': clan.imagePending
        ? 'private, no-store'
        : 'public, max-age=31536000, immutable',
    },
  });
};
