import { json } from '@sveltejs/kit';
import { onlineHandles } from '#lib/server/presence';
import { markActive } from '#lib/server/push';
import { markVisible } from '#lib/server/sync/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  // La page ne demande la présence que lorsqu'elle est visible : le suivi Steam en direct s'y fie.
  if (locals.user) markVisible(locals.user.id);
  // Un onglet visible avec un joueur devant : pas besoin de notification.
  if (locals.user && url.searchParams.has('actif')) markActive(locals.user.id);
  return json(await onlineHandles());
};
