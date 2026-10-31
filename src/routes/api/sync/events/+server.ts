import { error } from '@sveltejs/kit';
import { eventStream } from '$lib/server/sse';
import { onSync } from '$lib/server/sync/events';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  return eventStream((send) => onSync(user.id, send), request.signal);
};
