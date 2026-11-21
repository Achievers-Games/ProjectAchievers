import { EventEmitter } from 'node:events';
import type { Provider, SyncStatus } from '#prisma';
import type { CardDrop, Reward } from '#lib/collection';
import { globals } from '../globals';

/** Un succès qui vient de tomber : de quoi le fêter sur la page, sans la recharger. */
export interface UnlockPop {
  /** Identifiant du succès : la page ne fête jamais deux fois le même. */
  id: string;
  title: string;
  icon: string | null;
  game: string;
  /** La part de joueurs qui l'ont, en %, quand la plateforme la donne. */
  rarity?: number | null;
  /** L'adresse du jeu : plusieurs succès d'un même jeu se fêtent ensemble et mènent à lui. */
  slug: string;
}

export interface SyncEvent {
  provider: Provider;
  status: SyncStatus;
  processed: number;
  total: number;
  game?: string;
  error?: string | null;
  /** Succès gagnés pendant cette synchronisation. */
  achievements?: number;
  /** Lesquels, quand la page doit les fêter tout de suite. */
  unlocks?: UnlockPop[];
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

const bus = (globals.paEvents ??= new EventEmitter().setMaxListeners(0));

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

/** Une page visible demande la présence toutes les 30 s : au-delà, l'onglet est en arrière-plan. */
const VISIBLE_FOR = 75_000;
const lastVisible = new Map<string, number>();

/** L'onglet du joueur est au premier plan : la page vient de le signaler. */
export function markVisible(userId: string, now = Date.now()) {
  lastVisible.set(userId, now);
  if (lastVisible.size > 10_000) {
    for (const [id, at] of lastVisible) if (now - at > VISIBLE_FOR) lastVisible.delete(id);
  }
}

/**
 * Les joueurs qui ont une page ouverte et visible. Un onglet oublié en arrière-plan ne coûte
 * plus d'appels Steam : à son retour au premier plan, le passage suivant rattrape tout.
 */
export const visibleUsers = (now = Date.now()) =>
  connectedUsers().filter((userId) => now - (lastVisible.get(userId) ?? 0) <= VISIBLE_FOR);

export interface ChatEvent {
  type: 'chat';
  conversationId: string;
  message: {
    id: string;
    content: string;
    locale: string | null;
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

/** Une demande d'ami ou une invitation de clan, à montrer tout de suite sur le site. */
export interface InviteEvent {
  type: 'invite';
  from: string;
  invite: 'ami' | 'clan';
}

/** Un ou plusieurs succès du site : le navigateur demande leur titre dans sa langue. */
interface SiteAchievementEvent {
  type: 'site-achievement';
  codes: string[];
}

/** Des succès de plateforme débloqués pendant que la page était fermée : à fêter en arrivant. */
interface UnlocksEvent {
  type: 'unlocks';
  achievements: UnlockPop[];
}

export type LiveEvent =
  ChatEvent | InviteEvent | SiteAchievementEvent | UnlocksEvent | { type: 'steam-review' };

export const publishChat = (userId: string, event: LiveEvent) => bus.emit(`chat:${userId}`, event);

export function onChat(userId: string, listener: (event: LiveEvent) => void) {
  bus.on(`chat:${userId}`, listener);
  return () => void bus.off(`chat:${userId}`, listener);
}

export const publishCard = (drop: CardDrop) => {
  bus.emit('card', drop);
  publishHighlight();
};

/** Un gros événement public vient d'arriver : la page Global se recharge d'elle-même. */
export const publishHighlight = () => bus.emit('highlight');

export function onHighlight(listener: () => void) {
  bus.on('highlight', listener);
  return () => void bus.off('highlight', listener);
}

export function onCard(listener: (drop: CardDrop) => void) {
  bus.on('card', listener);
  return () => void bus.off('card', listener);
}

export const publishUnlock = (event: UnlockEvent) => bus.emit('unlock', event);

export function onUnlock(listener: (event: UnlockEvent) => void) {
  bus.on('unlock', listener);
  return () => void bus.off('unlock', listener);
}
