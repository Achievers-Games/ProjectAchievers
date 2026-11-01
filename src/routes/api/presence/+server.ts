import { json } from '@sveltejs/kit';
import { onlineHandles } from '$lib/server/presence';
import { markActive } from '$lib/server/push';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  // Seul un onglet visible interroge cette liste : ce joueur n'a pas besoin de notification.
  if (locals.user) markActive(locals.user.id);
  return json(await onlineHandles());
};
