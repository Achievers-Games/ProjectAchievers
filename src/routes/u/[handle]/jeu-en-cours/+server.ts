import { clientAddress } from '#lib/server/client-address';
import { availableProviders } from '#lib/server/providers';
import { eventStream } from '#lib/server/sse';
import { watchSteamPresence } from '#lib/server/sync/steam-presence';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  if (!availableProviders().STEAM) return new Response(null, { status: 204 });
  return eventStream<{ name: string; slug: string } | null>(
    (send) => watchSteamPresence(event.params.handle.toLowerCase(), send),
    event.request.signal,
    clientAddress(event),
  );
};
