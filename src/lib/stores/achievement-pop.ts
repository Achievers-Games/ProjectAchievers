import { writable } from 'svelte/store';

/** Un succès à fêter, du site ou d'une plateforme. */
export interface SitePop {
  title: string;
  /** Tracé du site ; vide quand le succès vient d'une plateforme, qui envoie son image. */
  icon: string;
  category: string;
  level: number;
  /** L'image du succès d'une plateforme, déjà dessinée par elle. */
  image?: string | null;
  /** Le jeu d'où vient le succès, pour les plateformes. */
  game?: string;
}

/** Une annonce de la pile : un succès à la fois. */
export interface PopItem {
  id: number;
  pop: SitePop;
}

/** La pile des succès à montrer : le premier est devant, les autres attendent derrière. */
export const popQueue = writable<PopItem[]>([]);

let nextId = 1;

export function celebrate(pops: SitePop[]) {
  if (!pops.length) return;
  popQueue.update((queue) => [...queue, ...pops.map((pop) => ({ id: nextId++, pop }))]);
}

export function dismissPop(id: number) {
  popQueue.update((queue) => queue.filter((item) => item.id !== id));
}

export function dismissAllPops() {
  popQueue.set([]);
}
