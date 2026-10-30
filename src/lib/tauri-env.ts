import { browser } from '$app/environment';

/**
 * True uniquement quand l'app tourne dans le runtime Tauri.
 * Dans un navigateur classique, toutes les APIs Tauri sont indisponibles.
 */
export const isTauri = (): boolean => {
  if (!browser || typeof window === 'undefined') return false;
  // Tauri exposes __TAURI_INTERNALS__ when the runtime is active
  return '__TAURI_INTERNALS__' in window;
};
