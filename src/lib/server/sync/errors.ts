import { logger } from '#lib/logger';

const log = logger('Synchronisation');

/** Erreur attendue d'une synchronisation : son message est un code, traduit à l'affichage. */
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

interface GameLoop<T> {
  platform: string;
  concurrency: number;
  name: (item: T) => string;
  report: (processed: number, total: number, game: string) => void;
}

/**
 * Synchronise chaque jeu et renvoie le nombre de réussites.
 *
 * Un jeu illisible ne coûte pas toute la bibliothèque : il sera repris au prochain passage.
 * Une `SyncError` concerne tout le compte et arrête la boucle, comme un échec général.
 */
export async function syncGames<T>(
  items: T[],
  { platform, concurrency, name, report }: GameLoop<T>,
  task: (item: T) => Promise<void>,
): Promise<number> {
  let processed = 0;
  let failed = 0;

  await mapLimit(items, concurrency, async (item) => {
    try {
      await task(item);
    } catch (error) {
      if (error instanceof SyncError) throw error;
      log.error(`Synchronisation ${platform} de « ${name(item)} » :`, error);
      failed += 1;
    }
    processed += 1;
    report(processed, items.length, name(item));
  });

  if (failed > 0 && failed === items.length) {
    throw new Error(`Aucun jeu ${platform} n'a pu être synchronisé`);
  }
  return processed - failed;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `fetch` avec nouvelles tentatives sur 429 et 5xx, en respectant `Retry-After`. */
export async function fetchRetry(url: string | URL, init?: RequestInit, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(20_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response: Response | undefined;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (error) {
      // Un appelant parti n'attend plus rien : inutile de retenter pour lui.
      if (init?.signal?.aborted || attempt >= attempts) throw error;
    }
    if (response && response.status !== 429 && response.status < 500) return response;
    if (response && attempt >= attempts) return response;

    const retryAfter = Number(response?.headers.get('retry-after'));
    const delay = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await sleep(Math.min(delay, 30_000));
  }
}
