/** Flux Server-Sent Events. `subscribe` renvoie la fonction de désinscription. */
export function eventStream<T>(
  subscribe: (send: (event: T) => void) => () => void,
  signal: AbortSignal,
): Response {
  let cleanup = () => {};

  const stream = new ReadableStream<string>({
    start(controller) {
      const send = (event: T) => controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      const unsubscribe = subscribe(send);
      // Commentaire périodique : garde la connexion ouverte à travers les proxys.
      const heartbeat = setInterval(() => controller.enqueue(': ping\n\n'), 25_000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        cleanup = () => {};
      };
      signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Déjà fermé par le client.
        }
      });
    },
    cancel() {
      cleanup();
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
