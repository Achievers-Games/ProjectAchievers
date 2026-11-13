import { clientAddress } from '#lib/server/client-address';
import { eventStream } from '#lib/server/sse';
import { onHighlight } from '#lib/server/sync/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
  eventStream<{ at: number }>(
    (send) => onHighlight(() => send({ at: Date.now() })),
    event.request.signal,
    clientAddress(event),
  );
