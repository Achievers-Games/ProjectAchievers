import type { Action } from 'svelte/action';

export type CardFrameTheme = 'forest' | 'underworld';

/** Affectations explicites, indépendantes du genre et de la rareté. */
export function cardFrameTheme(assetPath?: string | null): CardFrameTheme | null {
  switch (assetPath?.replace(/\/$/, '')) {
    case '/_proto/ori':
    case '/_proto/ori-mythique':
      return 'forest';
    case '/_proto/hades':
    case '/_proto/hades-mythique':
      return 'underworld';
    default:
      return null;
  }
}

/** Laisse peindre le décor au repos avant de lancer le déploiement de révélation. */
export const unfoldOnReveal: Action<HTMLElement, boolean> = (node, reveal) => {
  if (!reveal) return;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => node.setAttribute('data-frame-open', ''));
  });
  return { destroy: () => cancelAnimationFrame(frame) };
};
