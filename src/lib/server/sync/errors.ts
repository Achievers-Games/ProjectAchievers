/** Erreur attendue d'une synchronisation : son message est montré tel quel à l'utilisateur. */
export class SyncError extends Error {
  constructor(
    message: string,
    /** Le jeton a été révoqué : seule une nouvelle connexion peut réparer le compte. */
    readonly needsRelink = false,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/**
 * Exécute `task` sur chaque élément, avec au plus `limit` tâches simultanées.
 *
 * Une erreur arrête la distribution, et les tâches en cours sont attendues avant de
 * la relancer : aucune ne doit publier de progression après l'échec.
 */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const index = next++;
      try {
        await task(items[index] as T, index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
}

/** `fetch` avec nouvelles tentatives sur 429 et 5xx, en respectant `Retry-After`. */
export async function fetchRetry(url: string | URL, init?: RequestInit, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
    if (response && response.status !== 429 && response.status < 500) return response;
    if (response && attempt >= attempts) return response;

    const retryAfter = Number(response?.headers.get('retry-after'));
    const delay = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30_000)));
  }
}
