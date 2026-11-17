import { error } from '@sveltejs/kit';
import { readSmallBody } from '#lib/server/body';
import { parseCelebratedIds } from '#lib/server/sync/celebrated';
import { markCelebrated } from '#lib/server/sync/store';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

const MAX_BODY = 4096;

/**
 * La page a vraiment montré ces succès au joueur, onglet visible : plus aucun appareil ne les
 * rejoue. Avant cet accusé, un succès parti vers un téléphone en veille reste à fêter.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) error(401, m.login_required());
  const body = await readSmallBody(request, MAX_BODY);
  if (body === null) error(413, m.action_failed());
  const ids = parseCelebratedIds(body);
  if (!ids) error(400, m.action_failed());
  await markCelebrated(locals.user.id, ids);
  return new Response(null, { status: 204 });
};
