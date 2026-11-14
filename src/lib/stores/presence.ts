import { writable } from 'svelte/store';

const POLL = 30_000;
/** Sans geste depuis ce délai, le joueur a sans doute quitté son écran : il redevient joignable. */
const IDLE_AFTER = 5 * 60 * 1000;

/** Les joueurs actuellement sur le site, par identifiant public. */
export const online = writable<Set<string>>(new Set());

let lastGesture = 0;

const noteGesture = () => {
  lastGesture = Date.now();
};

export async function refreshPresence() {
  if (document.hidden) return;
  const active = Date.now() - lastGesture < IDLE_AFTER;
  const response = await fetch(active ? '/api/presence?actif=1' : '/api/presence').catch(
    () => null,
  );
  if (response?.ok) online.set(new Set((await response.json()) as string[]));
}

export function watchPresence() {
  noteGesture();
  const gestures = ['pointerdown', 'pointermove', 'keydown', 'scroll'];
  for (const name of gestures) addEventListener(name, noteGesture, { passive: true });
  // De retour au premier plan, l'onglet le dit tout de suite : le suivi Steam reprend aussitôt.
  const onVisible = () => {
    if (!document.hidden) void refreshPresence();
  };
  document.addEventListener('visibilitychange', onVisible);
  void refreshPresence();
  const timer = setInterval(refreshPresence, POLL);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    for (const name of gestures) removeEventListener(name, noteGesture);
  };
}
