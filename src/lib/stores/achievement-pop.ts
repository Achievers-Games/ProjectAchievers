import { writable } from 'svelte/store';

/** Un succès du site à fêter, tel que le renvoie `/api/succes`. */
export interface SitePop {
  title: string;
  icon: string;
  category: string;
  level: number;
}

/** Une annonce : un succès, ou un lot quand il en arrive trop d'un coup. */
export interface PopItem {
  id: number;
  pops: SitePop[];
}

/** Au-delà, les succès arrivent ensemble dans une seule annonce. */
const GROUP_FROM = 4;

export const popQueue = writable<PopItem[]>([]);

let nextId = 1;

export function celebrate(pops: SitePop[]) {
  if (!pops.length) return;
  const items =
    pops.length >= GROUP_FROM
      ? [{ id: nextId++, pops }]
      : pops.map((pop) => ({ id: nextId++, pops: [pop] }));
  popQueue.update((queue) => [...queue, ...items]);
}

export function dismissPop(id: number) {
  popQueue.update((queue) => queue.filter((item) => item.id !== id));
}
