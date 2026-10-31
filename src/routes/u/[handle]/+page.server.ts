import { error } from '@sveltejs/kit';
import { userProfile } from '$lib/server/queries';
import type { PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals }) => {
  const profile = await userProfile(params.handle, locals.user?.id ?? null, locals.user?.showAdult);
  if (!profile) error(404, m.profile_not_found());
  return { profile, origin: process.env.ORIGIN };
};
