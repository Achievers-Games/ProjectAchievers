import { get, writable } from 'svelte/store';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';

function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark';
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

/** Thème courant. L'app est dark-first (identité Kyara). */
export const theme = writable<Theme>(readStoredTheme());

function applyClass(value: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', value === 'dark');
}

/** À appeler une fois au démarrage : restaure la préférence et l'applique. */
export function initTheme(): void {
  const value = readStoredTheme();
  applyClass(value);
  theme.set(value);
}

export function setTheme(value: Theme): void {
  applyClass(value);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, value);
  }
  theme.set(value);
}

export function toggleTheme(): void {
  setTheme(get(theme) === 'dark' ? 'light' : 'dark');
}
