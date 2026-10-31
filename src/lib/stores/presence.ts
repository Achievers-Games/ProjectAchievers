import { writable } from 'svelte/store';

const POLL = 30_000;

/** Les joueurs actuellement sur le site, par identifiant public. */
export const online = writable<Set<string>>(new Set());

export async function refreshPresence() {
  if (document.hidden) return;
  const response = await fetch('/api/presence').catch(() => null);
  if (response?.ok) online.set(new Set((await response.json()) as string[]));
}

export function watchPresence() {
  void refreshPresence();
  const timer = setInterval(refreshPresence, POLL);
  return () => clearInterval(timer);
}
