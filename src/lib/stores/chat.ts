import { get, writable } from 'svelte/store';
import type { ChatEvent } from '$lib/server/sync/events';

const STORAGE_KEY = 'pa_discussions';
const MAX_OPEN = 3;

export interface DockChat {
  id: string;
  title: string;
  folded: boolean;
}

/** Dernier message reçu en direct : chaque discussion ouverte le lit. */
export const incoming = writable<ChatEvent | null>(null);

/** Messages non lus, sur toutes les discussions. */
export const unread = writable(0);

/** Discussions ouvertes en onglets, sur ordinateur. */
export const dockChats = writable<DockChat[]>([]);

/** Aucune fenêtre sur mobile : une discussion y prend toute la page. */
export const hasDock = () => matchMedia('(min-width: 768px)').matches;

export function openChat(id: string, title: string, folded = false) {
  dockChats.update((chats) => {
    const known = chats.find((chat) => chat.id === id);
    if (known) return chats.map((chat) => (chat === known ? { ...chat, folded } : chat));
    return [...chats, { id, title, folded }].slice(-MAX_OPEN);
  });
}

export const closeChat = (id: string) =>
  dockChats.update((chats) => chats.filter((chat) => chat.id !== id));

export const renameChat = (id: string, title: string) =>
  dockChats.update((chats) => chats.map((chat) => (chat.id === id ? { ...chat, title } : chat)));

/** Retrouve les fenêtres du joueur après un rechargement, et garde les suivantes. */
export function persistChats(userId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved?.userId === userId && Array.isArray(saved.chats)) dockChats.set(saved.chats);
  } catch {
    // Stockage indisponible : les fenêtres restent ouvertes jusqu'au rechargement.
  }
  return dockChats.subscribe((chats) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, chats }));
    } catch {
      // Stockage indisponible.
    }
  });
}

export const isChatOpen = (id: string) =>
  get(dockChats).some((chat) => chat.id === id && !chat.folded);
