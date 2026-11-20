/** Peel the top of the right seal downward; click/keyboard activation remains available. */
export function packTear(node: HTMLButtonElement, open: () => void) {
  let start = 0;
  let startX = 0;
  let pointer: number | null = null;
  let distance = 0;
  let moved = false;
  let suppressClick = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  function reset() {
    node.removeAttribute('data-dragging');
    node.style.setProperty('--peel', '0');
    node.style.setProperty('--peel-side', '0deg');
  }
  function down(event: PointerEvent) {
    if (node.disabled || event.button !== 0 || pointer !== null) return;
    const rect = node.getBoundingClientRect();
    if (
      event.clientX < rect.left + rect.width * 0.82 ||
      event.clientY > rect.top + rect.height * 0.45
    )
      return;
    start = event.clientY;
    startX = event.clientX;
    distance = Math.min(180, Math.max(80, rect.height * 0.65));
    pointer = event.pointerId;
    moved = false;
    suppressClick = false;
    clearTimeout(releaseTimer);
    node.setPointerCapture(pointer);
    node.dataset.dragging = '';
    node.removeAttribute('data-tilting');
    node.style.setProperty('--tilt-x', '0deg');
    node.style.setProperty('--tilt-y', '0deg');
    node.focus({ preventScroll: true });
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    const delta = Math.max(0, event.clientY - start);
    if (Math.hypot(event.clientY - start, event.clientX - startX) > 6) moved = true;
    node.dataset.dragging = '';
    node.style.setProperty('--peel', `${Math.min(1, delta / distance) * 0.62}`);
    node.style.setProperty(
      '--peel-side',
      `${Math.max(-12, Math.min(12, (-(event.clientX - startX) / distance) * 20))}deg`,
    );
  }
  function end(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    const complete = event.type === 'pointerup' && event.clientY - start >= distance * 0.7;
    suppressClick = moved || complete;
    const id = pointer;
    pointer = null;
    if (node.hasPointerCapture(id)) node.releasePointerCapture(id);
    if (complete) {
      node.removeAttribute('data-dragging');
      open();
    } else reset();
    // Ignore the synthetic click from a drag, but never a subsequent keyboard click.
    releaseTimer = setTimeout(() => (suppressClick = false), 0);
  }
  function click(event: MouseEvent) {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  }
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('lostpointercapture', end);
  node.addEventListener('click', click, true);
  return {
    destroy() {
      clearTimeout(releaseTimer);
      reset();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('lostpointercapture', end);
      node.removeEventListener('click', click, true);
    },
  };
}
