import { error } from '@sveltejs/kit';
import { eventStream } from '$lib/server/sse';
import { onSync } from '$lib/server/sync/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, 'Connexion requise');
  return eventStream((send) => onSync(user.id, send), request.signal);
};
