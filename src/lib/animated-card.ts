import type { Action } from 'svelte/action';
import type { EditionKind } from '#prisma';

/**
 * Les cartes animées des éditions. Chaque édition a son dossier (`GameEdition.assetPath`) avec un
 * `cards.js` qui s'enregistre dans `window.AchieversCards`, ses calques, et un `edition.json` :
 * les gros plans de la révélation et un son facultatif.
 */
export interface Focus {
  /** Point visé, en fraction de la largeur et de la hauteur de la carte. */
  x: number;
  y: number;
  zoom: number;
}
/** Un plan de caméra : un mouvement continu d'un cadrage à un autre, en millisecondes. */
export interface Shot {
  from: Focus;
  to: Focus;
  duration: number;
}
export interface EditionManifest {
  id: string;
  /** Ambiance de la révélation Mythique, facultative pour les éditions existantes. */
  glow?: string;
  atmosphere?: 'sparks' | 'wisps' | 'ash';
  /** Un son propre à la carte, relatif à son dossier : sans lui, la révélation garde ses sons. */
  sound: string | null;
  /**
   * Les plans de caméra de la révélation, dans l'ordre, séparés par un fondu au noir : par
   * exemple un travelling horizontal, un vertical, puis un dézoom jusqu'à la carte entière.
   */
  shots: Shot[];
}

interface CardApi {
  mount(canvas: HTMLCanvasElement, level?: number): Promise<() => void>;
}
declare global {
  interface Window {
    AchieversCards?: Record<string, CardApi>;
  }
}

const manifests = new Map<string, Promise<EditionManifest | null>>();
const scripts = new Map<string, Promise<void>>();

const inFolder = (assetPath: string, file: string) =>
  `${assetPath.endsWith('/') ? assetPath : `${assetPath}/`}${file}`;

/** Le manifeste d'une édition, chargé une fois ; rien si l'édition n'en a pas. */
export function loadManifest(assetPath: string) {
  let manifest = manifests.get(assetPath);
  if (!manifest) {
    manifest = fetch(inFolder(assetPath, 'edition.json'))
      .then((response) => (response.ok ? (response.json() as Promise<EditionManifest>) : null))
      .catch(() => null);
    manifests.set(assetPath, manifest);
  }
  return manifest;
}

function loadScript(assetPath: string) {
  let script = scripts.get(assetPath);
  if (!script) {
    script = new Promise<void>((resolve, reject) => {
      const src = inFolder(assetPath, 'cards.js');
      // Déjà chargé (par exemple avant un rechargement à chaud) : le rejouer redéclarerait tout.
      const loaded = [...document.scripts].some((element) => element.dataset.card === src);
      if (loaded) return resolve();
      const element = document.createElement('script');
      element.src = src;
      element.dataset.card = src;
      element.onload = () => resolve();
      element.onerror = () => reject(new Error(`Carte introuvable : ${assetPath}`));
      document.head.append(element);
    });
    scripts.set(assetPath, script);
  }
  return script;
}

export const soundUrl = (assetPath: string, sound: string) => inFolder(assetPath, sound);

/** Relief : la parallaxe seule. Vivante et Mythique : toutes les animations. */
export const levelFor = (kind: EditionKind) => (kind === 'RELIEF' ? 2 : 3);

/**
 * Monte la carte animée sur un canvas, et l'arrête au démontage. Tant qu'elle charge, ou si elle
 * manque, l'image fixe placée dessous reste visible : le canvas ne s'affiche qu'une fois prêt.
 */
export const animatedCard: Action<
  HTMLCanvasElement,
  { assetPath: string | null; level: number }
> = (canvas, params) => {
  let stop: (() => void) | undefined;
  let cancelled = false;
  void (async () => {
    if (!params.assetPath) return;
    const manifest = await loadManifest(params.assetPath);
    if (!manifest || cancelled) return;
    await loadScript(params.assetPath);
    const api = window.AchieversCards?.[manifest.id];
    if (!api || cancelled) return;
    stop = await api.mount(canvas, params.level);
    if (cancelled) stop();
    else canvas.dataset.ready = 'true';
  })().catch(() => {
    // L'image fixe reste : une carte animée manquante ne casse pas la révélation.
  });
  return {
    destroy() {
      cancelled = true;
      stop?.();
    },
  };
};
