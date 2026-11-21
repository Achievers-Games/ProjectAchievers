import type { Action } from 'svelte/action';
import type { CardFrameTheme } from '#lib/card-frame';
import { CARDS_URL } from '#lib/card-catalogue';
import { reportClientError } from '#lib/report';
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
  /**
   * Une intro de Mythique : elle remplace les plans de caméra, et la carte envoie
   * `card-intro-reveal` à `revealAt` millisecondes pour faire entrer le titre et le cadre.
   */
  intro?: { revealAt: number };
  /** Le cadre thématique de la carte ; sans cadre, le cadre standard. */
  frame?: CardFrameTheme;
  /** `fantasy` : le titre calligraphié dans la grille du booster ; sinon la plaque standard. */
  title?: 'fantasy' | 'plaque';
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

/**
 * L'image fixe d'une édition : le `full.jpg` de son dossier, cadré comme la carte animée. Une
 * Mythique vient d'une autre illustration que le visuel Steam : la montrer sous son canvas, au
 * chargement ou en mouvement réduit, évite un changement d'image. Sans dossier, le visuel du jeu.
 */
export const editionStill = (assetPath: string | null | undefined, fallback: string | null) =>
  assetPath ? inFolder(assetPath, 'full.jpg') : fallback;

/**
 * La miniature d'une édition pour les grilles : `thumb.webp`, générée à la publication (environ
 * 30 Ko au lieu de 200). Une carte de l'atelier, non publiée, n'en a pas : son image fixe sert.
 */
export const editionThumb = (assetPath: string | null | undefined, fallback: string | null) =>
  assetPath?.startsWith(`${CARDS_URL}/`)
    ? inFolder(assetPath, 'thumb.webp')
    : editionStill(assetPath, fallback);

/** Le jeu d'une carte, avec l'image fixe de son édition à la place du visuel Steam. */
export const withEditionStill = <Game extends { headerUrl: string | null }>(
  game: Game | null | undefined,
  assetPath: string | null | undefined,
) => (game ? { ...game, headerUrl: editionStill(assetPath, game.headerUrl) } : null);

/** Relief : la parallaxe seule. Vivante et Mythique : toutes les animations. */
export const levelFor = (kind: EditionKind) => (kind === 'RELIEF' ? 2 : 3);

/**
 * Monte la carte animée sur un canvas, et l'arrête au démontage. Tant qu'elle charge, ou si elle
 * manque, l'image fixe placée dessous reste visible : le canvas ne s'affiche qu'une fois prêt.
 */
export const animatedCard: Action<
  HTMLCanvasElement,
  /** `onready` part une fois la carte montée et visible : pour lancer son intro aussitôt. */
  { assetPath: string | null; level: number; onready?: () => void }
> = (canvas, params) => {
  let stop: (() => void) | undefined;
  let cancelled = false;
  const context = `carte ${params.assetPath}`;
  void (async () => {
    if (!params.assetPath) return;
    const manifest = await loadManifest(params.assetPath);
    if (cancelled) return;
    if (!manifest) throw new Error('edition.json introuvable ou illisible');
    await loadScript(params.assetPath);
    const api = window.AchieversCards?.[manifest.id];
    if (cancelled) return;
    if (!api) throw new Error(`cards.js n'enregistre pas « ${manifest.id} »`);
    stop = await api.mount(canvas, params.level);
    if (cancelled) stop();
    else {
      canvas.dataset.ready = 'true';
      params.onready?.();
    }
  })().catch((error: unknown) => {
    // L'image fixe reste : une carte animée manquante ne casse pas la révélation. Le journal du
    // serveur la signale, une fois par visite, pour qu'elle ne reste pas cassée sans que personne
    // ne le voie.
    reportClientError(error, context);
  });
  return {
    destroy() {
      cancelled = true;
      stop?.();
    },
  };
};
