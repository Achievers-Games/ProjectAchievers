import { writable } from 'svelte/store';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

export const toasts = writable<Toast[]>([]);

let nextId = 1;

export function toast(message: string, kind: Toast['kind'] = 'success') {
  const id = nextId++;
  toasts.update((list) => [...list, { id, kind, message }]);
  setTimeout(() => toasts.update((list) => list.filter((t) => t.id !== id)), 5000);
}
