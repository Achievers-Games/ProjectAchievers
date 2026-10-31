import { EventEmitter } from 'node:events';
import type { Provider, SyncStatus } from '@prisma/client';
import type { CardDrop, Reward } from '$lib/collection';

export interface SyncEvent {
  provider: Provider;
  status: SyncStatus;
  processed: number;
  total: number;
  game?: string;
  error?: string | null;
  /** Succès gagnés pendant cette synchronisation. */
  achievements?: number;
  /** Cartes rares obtenues pendant cette synchronisation. */
  rewards?: Reward[];
  moreRewards?: number;
}

export interface UnlockEvent {
  user: string;
  handle: string;
  avatarUrl: string | null;
  avatarMotionUrl: string | null;
  frame: string | null;
  frameMotionUrl: string | null;
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

export const publishCard = (drop: CardDrop) => bus.emit('card', drop);

export function onCard(listener: (drop: CardDrop) => void) {
  bus.on('card', listener);
  return () => void bus.off('card', listener);
}

export const publishUnlock = (event: UnlockEvent) => bus.emit('unlock', event);

export function onUnlock(listener: (event: UnlockEvent) => void) {
  bus.on('unlock', listener);
  return () => void bus.off('unlock', listener);
}
