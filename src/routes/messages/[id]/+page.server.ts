import { error } from '@sveltejs/kit';
import { requireLogin } from '$lib/server/auth';
import { conversationTitle } from '$lib/server/social';
import { m } from '$lib/paraglide/messages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const user = requireLogin(locals, `/messages/${params.id}`);
  const title = await conversationTitle(user.id, params.id);
  if (title === null) error(404, m.gone());
  return { id: params.id, title };
};
