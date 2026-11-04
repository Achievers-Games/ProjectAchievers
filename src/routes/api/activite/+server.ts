import { eventStream } from '#lib/server/sse';
import { onUnlock } from '#lib/server/sync/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) =>
  eventStream((send) => onUnlock(send), request.signal);
