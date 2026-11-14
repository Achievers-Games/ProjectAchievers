import { error, json } from '@sveltejs/kit';
import { refreshAccounts, SYNC_DELAYS } from '#lib/server/sync/queue';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());
  return json({ started: await refreshAccounts(locals.user.id, SYNC_DELAYS.manual) });
};
