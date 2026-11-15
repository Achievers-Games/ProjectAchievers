import { error, json } from '@sveltejs/kit';
import { checkSteamPrivacy } from '#lib/server/sync/live';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

/** La fenêtre des jeux cachés demande si le joueur a réglé Steam. */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());
  return json({ fixed: await checkSteamPrivacy(locals.user.id) });
};
