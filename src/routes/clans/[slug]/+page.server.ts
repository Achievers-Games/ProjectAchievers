import { error, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { clanAchievementBoard } from '#lib/server/site-achievements';
import { clanPage, flagClanName } from '#lib/server/social';
import { m } from '#lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const [clan, row] = await Promise.all([
    clanPage(params.slug),
    db.clan.findUnique({ where: { slug: params.slug }, select: { id: true } }),
  ]);
  if (!clan || !row) error(404, m.gone());
  return {
    clan,
    achievements: await clanAchievementBoard(row.id),
    moderator: Boolean(locals.user && locals.user.role !== 'USER'),
  };
};

export const actions: Actions = {
  // Un nom contraire aux règles : le clan en prend un neutre, son chef doit en choisir un autre.
  flagName: async ({ params, locals }) => {
    if (!locals.user || locals.user.role === 'USER') error(404, m.not_found());
    const clan = await db.clan.findUnique({ where: { slug: params.slug }, select: { id: true } });
    if (!clan) error(404, m.gone());
    await flagClanName(clan.id);
    redirect(303, '/clans');
  },
  // Un emblème déplacé disparaît ; le chef peut en envoyer un autre.
  removeImage: async ({ params, locals }) => {
    if (!locals.user || locals.user.role === 'USER') error(404, m.not_found());
    await db.clan.updateMany({
      where: { slug: params.slug },
      data: { image: null, imageType: null, imageAt: null, imagePending: false },
    });
  },
};
