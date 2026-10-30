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

/** Exécute `task` sur chaque élément, avec au plus `limit` tâches simultanées. */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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
