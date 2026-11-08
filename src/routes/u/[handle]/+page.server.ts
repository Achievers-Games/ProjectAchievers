import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { env } from '#lib/server/env';
import { userProfile } from '#lib/server/queries';
import { siteAchievementCount } from '#lib/server/site-achievements';
import { relationWith } from '#lib/server/social';
import type { PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals }) => {
  const profile = await userProfile(params.handle, locals.user?.id ?? null, locals.user?.showAdult);
  if (!profile) error(404, m.profile_not_found());
  // Les cartes du profil ouvrent la comparaison sur les versions que je possède déjà.
  const shown = [...profile.showcase, ...profile.games];
  const viewer = locals.user && locals.user.id !== profile.user.id ? locals.user : null;

  // Trois lectures indépendantes : les mener de front épargne des allers-retours à la base.
  const [relation, siteAchievements, compareIds] = await Promise.all([
    locals.user ? relationWith(locals.user.id, profile.user.id) : null,
    siteAchievementCount(profile.user.id),
    viewer && shown.length
      ? db.userGame
          .findMany({
            where: { userId: viewer.id, gameId: { in: shown.map((card) => card.id) } },
            select: { gameId: true },
          })
          .then((rows) => rows.map((row) => row.gameId))
      : ([] as string[]),
  ]);
  return { profile, relation, siteAchievements, compareIds, origin: env().ORIGIN };
};
