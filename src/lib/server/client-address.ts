import type { RequestEvent } from '@sveltejs/kit';

/** Le client peut déjà être parti : ce n'est pas une raison de répondre 500. */
export function clientAddress(event: Pick<RequestEvent, 'getClientAddress'>): string {
  try {
    return event.getClientAddress();
  } catch {
    return 'inconnue';
  }
}
