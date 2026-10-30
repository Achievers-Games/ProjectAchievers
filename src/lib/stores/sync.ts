import { writable } from 'svelte/store';
import type { Provider, SyncStatus } from '@prisma/client';
import type { Reward } from '$lib/tiers';

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

/** Cartes à révéler, dans l'ordre. */
export const rewards = writable<Reward[]>([]);
