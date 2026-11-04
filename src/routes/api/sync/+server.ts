import { error, json } from '@sveltejs/kit';
import { refreshAccounts } from '#lib/server/sync/queue';
import { requestStoreSweep } from '#lib/server/sync/steam';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

/** Assez long pour ne pas abuser des plateformes, assez court pour rester utile. */
const COOLDOWN = 2 * 60 * 1000;

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());
  await requestStoreSweep(locals.user.id);
  return json({ started: await refreshAccounts(locals.user.id, COOLDOWN) });
};
