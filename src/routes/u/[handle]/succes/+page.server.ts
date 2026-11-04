import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { publicUser } from '#lib/server/queries';
import { siteAchievementBoard } from '#lib/server/site-achievements';
import type { PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals }) => {
  const viewerId = locals.user?.id ?? null;
  const user = await db.user.findFirst({
    where: { handle: params.handle, OR: [{ isPublic: true }, { id: viewerId ?? '' }] },
    select: { id: true, ...publicUser },
  });
  if (!user) error(404, m.profile_not_found());
  return {
    player: user,
    board: await siteAchievementBoard(user.id, viewerId, locals.user?.showAdult),
  };
};
