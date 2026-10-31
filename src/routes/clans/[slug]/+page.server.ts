import { error } from '@sveltejs/kit';
import { clanPage } from '$lib/server/social';
import { m } from '$lib/paraglide/messages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const clan = await clanPage(params.slug);
  if (!clan) error(404, m.gone());
  return { clan };
};
