/** Au-delà, un flux ouvert ne peut plus l'être : le serveur garde de quoi répondre au reste. */
const MAX_STREAMS = 2_000;
let openStreams = 0;

/** Flux Server-Sent Events. `subscribe` renvoie la fonction de désinscription. */
export function eventStream<T>(
  subscribe: (send: (event: T) => void) => () => void,
  signal: AbortSignal,
): Response {
  if (openStreams >= MAX_STREAMS) {
    return new Response(null, { status: 503, headers: { 'Retry-After': '60' } });
  }
  openStreams += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    openStreams -= 1;
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
      signal.addEventListener('abort', () => {
        close();
        try {
          controller.close();
        } catch {
          // Déjà fermé par le client.
        }
      });
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
