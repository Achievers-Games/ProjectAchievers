import { writable } from 'svelte/store';
import type { Provider, SyncStatus } from '@prisma/client';
import type { Reward } from '$lib/collection';

export interface SyncProgress {
  provider: Provider;
  status: SyncStatus;
  processed: number;
  total: number;
  game?: string;
  error?: string | null;
  achievements?: number;
  rewards?: Reward[];
  moreRewards?: number;
}

export const syncState = writable<Partial<Record<Provider, SyncProgress>>>({});

export interface PendingRewards {
  cards: Reward[];
  /** Cartes obtenues en plus de celles envoyées par le serveur. */
  more: number;
}

export const NO_REWARDS: PendingRewards = { cards: [], more: 0 };

/** Cartes à révéler. */
export const rewards = writable<PendingRewards>(NO_REWARDS);

const PENDING_KEY = 'pa_cartes';

/** Garde les cartes à révéler le temps de l'onglet : un rechargement ne doit pas les perdre. */
export function persistRewards() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    if (Array.isArray(saved?.cards)) rewards.set(saved as PendingRewards);
  } catch {
    // Stockage indisponible : la révélation fonctionne quand même.
  }
  return rewards.subscribe((pending) => {
    try {
      if (pending.cards.length) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      else sessionStorage.removeItem(PENDING_KEY);
    } catch {
      // Stockage indisponible.
    }
  });
}
