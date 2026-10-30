import { error } from '@sveltejs/kit';
import { userProfile } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const profile = await userProfile(params.handle, locals.user?.id ?? null, locals.user?.showAdult);
  if (!profile) error(404, 'Ce profil est introuvable ou privé.');
  return { profile, origin: process.env.ORIGIN };
};
