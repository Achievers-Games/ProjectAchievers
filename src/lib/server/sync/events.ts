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
  /** Synchronisation automatique : rien à annoncer sans nouveauté. */
  quiet?: boolean;
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

/** Les joueurs qui ont une page du site ouverte en ce moment. */
export const connectedUsers = () =>
  bus
    .eventNames()
    .flatMap((name) =>
      typeof name === 'string' && name.startsWith('sync:') ? [name.slice('sync:'.length)] : [],
    );

export interface ChatEvent {
  type: 'chat';
  conversationId: string;
  message: {
    id: string;
    content: string;
    createdAt: Date;
    author: {
      id: string;
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
    };
  };
}

export const publishChat = (userId: string, event: ChatEvent) => bus.emit(`chat:${userId}`, event);

export function onChat(userId: string, listener: (event: ChatEvent) => void) {
  bus.on(`chat:${userId}`, listener);
  return () => void bus.off(`chat:${userId}`, listener);
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
