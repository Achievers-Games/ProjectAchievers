import { error } from '@sveltejs/kit';
import { eventStream } from '$lib/server/sse';
import {
  onChat,
  onSync,
  type ChatEvent,
  type InviteEvent,
  type SyncEvent,
} from '$lib/server/sync/events';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';

/** Un seul flux par onglet : synchronisations et messages arrivent par le même chemin. */
export const GET: RequestHandler = ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  return eventStream<SyncEvent | ChatEvent | InviteEvent>((send) => {
    const stopSync = onSync(user.id, send);
    const stopChat = onChat(user.id, send);
    return () => {
      stopSync();
      stopChat();
    };
  }, request.signal);
};
