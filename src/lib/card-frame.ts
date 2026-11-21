import type { Action } from 'svelte/action';

export type CardFrameTheme = 'forest' | 'underworld' | 'maple' | 'laboratory';

/** Laisse peindre le décor au repos avant de lancer le déploiement de révélation. */
export const unfoldOnReveal: Action<HTMLElement, boolean> = (node, reveal) => {
  if (!reveal) return;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => node.setAttribute('data-frame-open', ''));
  });
  return { destroy: () => cancelAnimationFrame(frame) };
};
