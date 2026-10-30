import { writable } from 'svelte/store';
import type { Provider, SyncStatus } from '@prisma/client';

export interface SyncProgress {
  provider: Provider;
  status: SyncStatus;
  processed: number;
  total: number;
  game?: string;
  error?: string | null;
}

export const syncState = writable<Partial<Record<Provider, SyncProgress>>>({});
