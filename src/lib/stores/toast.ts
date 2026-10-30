// Toast léger — remplace sonner (spécifique React) dans l'architecture Svelte.
import { writable } from 'svelte/store';

export type Toast = {
  id: number;
  kind: 'success' | 'error' | 'warning';
  message: string;
  description?: string;
};

let nextId = 0;

export const toasts = writable<Toast[]>([]);

function push(kind: Toast['kind'], message: string, description?: string) {
  const id = ++nextId;
  toasts.update((list) => [...list, { id, kind, message, description }]);
  setTimeout(() => {
    toasts.update((list) => list.filter((t) => t.id !== id));
  }, 5000);
}

export const toast = {
  success: (message: string, description?: string) => push('success', message, description),
  error: (message: string, description?: string) => push('error', message, description),
  warning: (message: string, description?: string) => push('warning', message, description),
};
