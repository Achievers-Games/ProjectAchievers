import { error } from '@sveltejs/kit';
import { getLocale } from '$lib/paraglide/runtime';
import { localizeAchievements } from '$lib/server/achievement-texts';
import { pinnedAchievements, userProfile } from '$lib/server/queries';
import type { PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals }) => {
  const profile = await userProfile(params.handle, locals.user?.id ?? null, locals.user?.showAdult);
  if (!profile) error(404, m.profile_not_found());
  const pinned = await pinnedAchievements(profile.user.id, locals.user?.showAdult ?? false);
  return {
    profile,
    pinned: await localizeAchievements(pinned, getLocale()),
    origin: process.env.ORIGIN,
  };
};
