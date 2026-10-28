import { writable } from 'svelte/store';

export const authModalOpen = writable(false);

export function openAuthModal() {
  authModalOpen.set(true);
}

export function closeAuthModal() {
  authModalOpen.set(false);
}
