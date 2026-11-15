import { error, json } from '@sveltejs/kit';
import { checkPlaytimePrivacy } from '#lib/server/sync/live';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

/** La fenêtre « temps de jeu privé » demande si le joueur l'a rendu public dans Steam. */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());
  return json({ public: await checkPlaytimePrivacy(locals.user.id) });
};
