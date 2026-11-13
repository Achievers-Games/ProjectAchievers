import { writable } from 'svelte/store';
import type { UnlockPop } from './sync';

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
interface PopItem {
  id: number;
  pop: SitePop;
}

/** La pile des succès à montrer : le premier est devant, les autres attendent derrière. */
export const popQueue = writable<PopItem[]>([]);

let nextId = 1;

const SEEN_KEY = 'pa_succes_vus';
/** Au-delà, un succès oublié n'est plus une nouvelle à fêter. */
const SEEN_TTL = 30 * 24 * 60 * 60 * 1000;

function readSeen(): Record<string, number> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? (saved as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * Fête des succès de plateforme une seule fois par navigateur. Le flux les renvoie à chaque
 * visite tant qu'ils sont récents : sans cette mémoire, un rechargement les rejouerait.
 */
export function celebrateOnce(unlocks: UnlockPop[]) {
  if (!unlocks.length) return;
  const now = Date.now();
  const seen = readSeen();
  const fresh = unlocks.filter((unlock) => !seen[unlock.id]);
  if (!fresh.length) return;

  const kept = Object.entries(seen).filter(([, at]) => now - at < SEEN_TTL);
  const next = {
    ...Object.fromEntries(kept),
    ...Object.fromEntries(fresh.map((u) => [u.id, now])),
  };
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Stockage plein ou masqué : le succès se fête quand même.
  }

  celebrate(
    fresh.map(({ title, icon, game }) => ({
      title,
      game,
      icon: '',
      category: 'platform',
      level: 0,
      image: icon,
    })),
  );
}

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
