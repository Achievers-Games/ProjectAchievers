const elements = new Map<HTMLElement, boolean>();
let observer: IntersectionObserver | undefined;

function apply(node: HTMLElement, visible: boolean) {
  node.dataset.effectsPaused = String(!visible || document.visibilityState === 'hidden');
}
function visibilityChanged() {
  for (const [node, visible] of elements) apply(node, visible);
}

/** Un seul observateur et un seul écouteur pour toutes les cartes de la page. */
export function pauseEffects(node: HTMLElement) {
  const supported = typeof IntersectionObserver !== 'undefined';
  if (!elements.size) document.addEventListener('visibilitychange', visibilityChanged);
  elements.set(node, !supported);
  apply(node, !supported);
  if (supported) {
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (!elements.has(target)) continue;
        elements.set(target, entry.isIntersecting);
        apply(target, entry.isIntersecting);
      }
    });
    observer.observe(node);
  }
  return {
    destroy() {
      observer?.unobserve(node);
      elements.delete(node);
      delete node.dataset.effectsPaused;
      if (!elements.size) {
        observer?.disconnect();
        observer = undefined;
        document.removeEventListener('visibilitychange', visibilityChanged);
      }
    },
  };
}
