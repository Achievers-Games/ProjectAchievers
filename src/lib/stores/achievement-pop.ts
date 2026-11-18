import { get, writable } from 'svelte/store';
import type { UnlockPop } from './sync';

/** Un succès à fêter, du site ou d'une plateforme. */
export interface SitePop {
  title: string;
  /** Tracé du site ; vide quand le succès vient d'une plateforme, qui envoie son image. */
  icon: string;
  category: string;
  level: number;
  /** Le niveau du palier atteint, de Bronze (1) à Légendaire (6) : la couleur du badge. */
  tier?: number;
  /** L'image du succès d'une plateforme, déjà dessinée par elle. */
  image?: string | null;
  /** Le jeu d'où vient le succès, pour les plateformes. */
  game?: string;
  /** Où mène un clic : le succès, ou la page du jeu quand plusieurs se fêtent ensemble. */
  href?: string;
  /** Plusieurs succès d'un même jeu, réunis en une seule annonce. */
  count?: number;
  /** Les succès de plateforme annoncés : le serveur attend que le joueur les ait vus. */
  unlocks?: UnlockPop[];
}

/** Une annonce de la pile : un succès à la fois. */
export interface PopItem {
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

function writeSeen(ids: string[]) {
  const now = Date.now();
  const kept = Object.entries(readSeen()).filter(([, at]) => now - at < SEEN_TTL);
  const next = { ...Object.fromEntries(kept), ...Object.fromEntries(ids.map((id) => [id, now])) };
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Stockage plein ou masqué : le serveur retient quand même l'accusé.
  }
}

/** Le joueur a vu ces succès : le compte les retient, aucun appareil ne les rejouera. */
function acknowledge(ids: string[]) {
  if (!ids.length) return;
  writeSeen(ids);
  void fetch('/api/sync/fetes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ids),
    keepalive: true,
  }).catch(() => {
    // Hors ligne : le succès reviendra à la prochaine visite, et cette mémoire l'écartera.
  });
}

/**
 * Met en file des succès de plateforme. Rien n'est retenu ici : un succès reçu par un onglet
 * caché, ou un téléphone en veille, reste à fêter tant que le joueur ne l'a pas vu.
 */
export function celebrateOnce(unlocks: UnlockPop[]) {
  if (!unlocks.length) return;
  const seen = readSeen();
  const queued = new Set(get(popQueue).flatMap((item) => idsOf(item.pop)));
  const fresh = unlocks.filter((unlock) => !seen[unlock.id] && !queued.has(unlock.id));
  if (!fresh.length) return;
  popQueue.update((queue) => {
    const next = [...queue];
    // Pas de `Map.groupBy` ici : ce code tourne dans des navigateurs qui ne l'ont pas encore.
    const byGame = new Map<string, UnlockPop[]>();
    for (const unlock of fresh)
      byGame.set(unlock.slug, [...(byGame.get(unlock.slug) ?? []), unlock]);
    for (const [slug, list] of byGame) {
      // Le jeu attend déjà derrière : ses nouveaux succès le rejoignent. Jamais celui affiché,
      // qui changerait sous les yeux du joueur.
      const at = next.findIndex((item, index) => index > 0 && item.pop.unlocks?.[0]?.slug === slug);
      if (at > 0) next[at] = { ...next[at]!, pop: gamePop([...next[at]!.pop.unlocks!, ...list]) };
      else next.push({ id: nextId++, pop: gamePop(list) });
    }
    return next;
  });
}

/**
 * Les succès d'un jeu : un seul garde son image et mène à sa page ; plusieurs se fêtent
 * ensemble et mènent au jeu, plutôt que de défiler un par un.
 */
function gamePop(unlocks: UnlockPop[]): SitePop {
  const [first] = unlocks as [UnlockPop, ...UnlockPop[]];
  const base = { icon: '', category: 'platform', level: 0, image: first.icon, unlocks };
  if (unlocks.length === 1) {
    return { ...base, title: first.title, game: first.game, href: `/succes/${first.id}` };
  }
  return { ...base, title: first.game, count: unlocks.length, href: `/jeux/${first.slug}` };
}

const idsOf = (pop: SitePop) => pop.unlocks?.map((unlock) => unlock.id) ?? [];

/**
 * L'annonce s'affiche, onglet visible. Faux si un autre onglet l'a déjà montrée entre-temps :
 * elle quitte alors la pile sans se rejouer.
 */
export function present(item: PopItem): boolean {
  const ids = idsOf(item.pop);
  if (!ids.length) return true;
  const seen = readSeen();
  if (ids.every((id) => seen[id])) {
    dismissPop(item.id);
    return false;
  }
  acknowledge(ids);
  return true;
}

/**
 * Des succès du site : rares et propres au site, ils passent devant les jeux qui attendent,
 * sans remplacer l'annonce déjà à l'écran.
 */
export function celebrate(pops: SitePop[]) {
  if (!pops.length) return;
  popQueue.update((queue) => {
    const items = pops.map((pop) => ({ id: nextId++, pop }));
    const at = queue.findIndex((item, index) => index > 0 && item.pop.category === 'platform');
    return at < 0 ? [...queue, ...items] : [...queue.slice(0, at), ...items, ...queue.slice(at)];
  });
}

export function dismissPop(id: number) {
  popQueue.update((queue) => queue.filter((item) => item.id !== id));
}

export function dismissAllPops() {
  popQueue.set([]);
}

/** Le joueur ferme la pile : ceux qui attendaient derrière comptent pour vus. */
export function closeAllPops() {
  const ids = get(popQueue).flatMap((item) => idsOf(item.pop));
  acknowledge(ids);
  dismissAllPops();
}
