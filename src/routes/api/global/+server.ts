import { eventStream } from '#lib/server/sse';
import { onHighlight } from '#lib/server/sync/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) =>
  eventStream<{ at: number }>(
    (send) => onHighlight(() => send({ at: Date.now() })),
    request.signal,
  );
