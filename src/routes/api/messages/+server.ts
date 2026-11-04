import { error, json } from '@sveltejs/kit';
import { listConversations } from '#lib/server/social';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());
  return json(await listConversations(locals.user.id));
};
