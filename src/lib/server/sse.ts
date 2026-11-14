/** Au-delà, un flux ouvert ne peut plus l'être : le serveur garde de quoi répondre au reste. */
const MAX_STREAMS = 2_000;
/** Une douzaine d'onglets, pas davantage : une seule adresse ne doit pas remplir le plafond global. */
const MAX_PER_OWNER = 12;
let openStreams = 0;
const openByOwner = new Map<string, number>();

/**
 * Flux Server-Sent Events. `subscribe` renvoie la fonction de désinscription. `owner` désigne
 * celui qui ouvre le flux (une adresse, un joueur) : ses flux simultanés sont plafonnés.
 */
export function eventStream<T>(
  subscribe: (send: (event: T) => void) => () => void,
  signal: AbortSignal,
  owner?: string,
): Response {
  const mine = owner === undefined ? 0 : (openByOwner.get(owner) ?? 0);
  if (openStreams >= MAX_STREAMS || mine >= MAX_PER_OWNER) {
    return new Response(null, { status: 503, headers: { 'Retry-After': '60' } });
  }
  openStreams += 1;
  if (owner !== undefined) openByOwner.set(owner, mine + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    openStreams -= 1;
    if (owner === undefined) return;
    const left = (openByOwner.get(owner) ?? 1) - 1;
    if (left > 0) openByOwner.set(owner, left);
    else openByOwner.delete(owner);
  };

  let cleanup = () => {};
  const close = () => {
    cleanup();
    release();
  };

  const stream = new ReadableStream<string>({
    start(controller) {
      // Un client parti ne doit pas lever d'erreur chez l'émetteur, en pleine synchronisation.
      const write = (chunk: string) => {
        try {
          controller.enqueue(chunk);
        } catch {
          close();
        }
      };
      const send = (event: T) => write(`data: ${JSON.stringify(event)}\n\n`);
      // Premier octet immédiat : sans lui, les en-têtes attendent le premier événement.
      write(': ok\n\n');
      let unsubscribe: () => void;
      try {
        unsubscribe = subscribe(send);
      } catch (error) {
        release();
        throw error;
      }
      // Commentaire périodique : garde la connexion ouverte à travers les proxys.
      const heartbeat = setInterval(() => write(': ping\n\n'), 25_000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        cleanup = () => {};
      };
      const abort = () => {
        close();
        try {
          controller.close();
        } catch {
          // Déjà fermé par le client.
        }
      };
      // Un client parti avant l'ouverture du flux ne déclenchera plus jamais l'événement.
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
