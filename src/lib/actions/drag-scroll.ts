/**
 * Fait glisser une liste horizontale à la souris, comme on la ferait glisser au doigt.
 * Le tactile défile déjà nativement : l'action ne s'occupe que du pointeur d'une souris.
 */
export function dragScroll(
  element: HTMLElement,
  options: { onDrag?: (dragging: boolean) => void } = {},
) {
  let pointer = -1;
  let startX = 0;
  let startLeft = 0;
  let moved = false;

  function onDown(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startLeft = element.scrollLeft;
    moved = false;
    try {
      element.setPointerCapture(pointer);
    } catch {
      // Un pointeur déjà relâché : le glissement se fait quand même, sans capture.
    }
  }

  function onMove(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    const delta = event.clientX - startX;
    if (!moved && Math.abs(delta) < 6) return;
    if (!moved) {
      moved = true;
      element.dataset.dragging = 'true';
      element.style.userSelect = 'none';
      options.onDrag?.(true);
    }
    event.preventDefault();
    element.scrollLeft = startLeft - delta;
  }

  function onUp(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    pointer = -1;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (!moved) return;
    moved = false;
    element.style.removeProperty('user-select');
    options.onDrag?.(false);
    // Le clic qui suit un glissement ne doit pas ouvrir la carte qu'on vient de déplacer.
    setTimeout(() => delete element.dataset.dragging);
  }

  /**
   * Les cartes sont des liens : le navigateur lancerait son propre glisser-déposer et
   * interromprait le geste. Le rail, lui, ne transporte rien.
   */
  function onDragStart(event: DragEvent) {
    event.preventDefault();
  }

  /** Le lien sous le curseur ne doit pas se déclencher après un glissement. */
  function onClick(event: MouseEvent) {
    if (!element.dataset.dragging) return;
    event.preventDefault();
    event.stopPropagation();
  }

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);
  element.addEventListener('dragstart', onDragStart);
  element.addEventListener('click', onClick, true);
  return {
    destroy() {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('dragstart', onDragStart);
      element.removeEventListener('click', onClick, true);
      element.style.removeProperty('user-select');
    },
  };
}
