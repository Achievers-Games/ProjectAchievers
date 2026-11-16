import { error } from '@sveltejs/kit';
import { env } from '#lib/server/env';
import { toBanner, userProfile } from '#lib/server/queries';
import { siteAchievementCount } from '#lib/server/site-achievements';
import { relationWith } from '#lib/server/social';
import type { PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals, depends }) => {
  depends('app:sync');
  const profile = await userProfile(params.handle, locals.user?.id ?? null, locals.user?.showAdult);
  if (!profile) error(404, m.profile_not_found());
  // Deux lectures indépendantes : les mener de front épargne un aller-retour à la base.
  const [relation, siteAchievements] = await Promise.all([
    locals.user ? relationWith(locals.user.id, profile.user.id) : null,
    siteAchievementCount(profile.user.id),
  ]);
  // La première carte de la vitrine habille la bannière : c'est le jeu que le joueur met en avant.
  const first = profile.showcase[0];
  const banner = first?.headerUrl ? toBanner({ ...first, headerUrl: first.headerUrl }) : null;
  return { profile, relation, siteAchievements, banner, origin: env().ORIGIN };
};
