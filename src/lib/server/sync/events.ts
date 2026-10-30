import { EventEmitter } from 'node:events';
import type { Provider, SyncStatus } from '@prisma/client';

export interface SyncEvent {
  provider: Provider;
  status: SyncStatus;
  processed: number;
  total: number;
  game?: string;
  error?: string | null;
}

export interface UnlockEvent {
  user: string;
  handle: string;
  avatarUrl: string | null;
  game: string;
  gameSlug: string;
  count: number;
}

const globalForEvents = globalThis as unknown as { paEvents?: EventEmitter };
const bus = (globalForEvents.paEvents ??= new EventEmitter().setMaxListeners(0));

export const publishSync = (userId: string, event: SyncEvent) => bus.emit(`sync:${userId}`, event);

export function onSync(userId: string, listener: (event: SyncEvent) => void) {
  bus.on(`sync:${userId}`, listener);
  return () => void bus.off(`sync:${userId}`, listener);
}

export const publishUnlock = (event: UnlockEvent) => bus.emit('unlock', event);

export function onUnlock(listener: (event: UnlockEvent) => void) {
  bus.on('unlock', listener);
  return () => void bus.off('unlock', listener);
}
