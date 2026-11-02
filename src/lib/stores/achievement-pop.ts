import { writable } from 'svelte/store';

/** Un succès du site à fêter, tel que le renvoie `/api/succes`. */
export interface SitePop {
  title: string;
  icon: string;
  category: string;
  level: number;
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
