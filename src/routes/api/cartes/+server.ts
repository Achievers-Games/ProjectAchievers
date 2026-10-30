import { eventStream } from '$lib/server/sse';
import { onCard } from '$lib/server/sync/events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) =>
  eventStream((send) => onCard(send), request.signal);
