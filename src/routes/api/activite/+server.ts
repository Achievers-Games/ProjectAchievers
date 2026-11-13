import { clientAddress } from '#lib/server/client-address';
import { eventStream } from '#lib/server/sse';
import { onUnlock } from '#lib/server/sync/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
  eventStream((send) => onUnlock(send), event.request.signal, clientAddress(event));
