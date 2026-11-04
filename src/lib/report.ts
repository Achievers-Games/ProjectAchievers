/**
 * Remonte au journal du serveur les erreurs vues par le navigateur. Rien ne passe par un tiers :
 * le propre serveur du site les reçoit et les écrit dans son journal, à côté des erreurs serveur.
 */

/** Une même erreur n'est envoyée qu'une fois par visite, et les envois restent bornés. */
const reported = new Set<string>();
const MAX_REPORTS = 10;

const shorten = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length)}…` : value;

/** SvelteKit 3 remet parfois une erreur d'application (objet `message`) plutôt qu'une `Error`. */
function textOf(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? '' };
  if (error && typeof error === 'object' && 'message' in error) {
    return { message: String((error as { message: unknown }).message), stack: '' };
  }
  return { message: String(error), stack: '' };
}

export function reportClientError(error: unknown, context: string): void {
  try {
    const { message, stack } = textOf(error);
    const key = `${context}\n${message}`;
    if (reported.has(key) || reported.size >= MAX_REPORTS) return;
    reported.add(key);

    const body = JSON.stringify({
      message: shorten(message, 300),
      stack: shorten(stack, 1500),
      context: shorten(context, 200),
    });
    // `keepalive` laisse partir le rapport même si la page se ferme dans la foulée.
    void fetch('/api/erreur', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Le serveur peut être justement celui qui ne répond plus : inutile d'insister.
    });
  } catch {
    // Signaler une erreur ne doit jamais en provoquer une seconde.
  }
}
