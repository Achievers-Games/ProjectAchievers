import { error } from '@sveltejs/kit';
import { userProfile } from '#lib/server/queries';
import { siteAchievementCount } from '#lib/server/site-achievements';
import { relationWith } from '#lib/server/social';
import type { PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals }) => {
  const profile = await userProfile(params.handle, locals.user?.id ?? null, locals.user?.showAdult);
  if (!profile) error(404, m.profile_not_found());
  // Deux lectures indépendantes : les mener de front épargne un aller-retour à la base.
  const [relation, siteAchievements] = await Promise.all([
    locals.user ? relationWith(locals.user.id, profile.user.id) : null,
    siteAchievementCount(profile.user.id),
  ]);
  return { profile, relation, siteAchievements, origin: process.env.ORIGIN };
};
