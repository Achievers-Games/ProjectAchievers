/** Incline une carte rare vers le pointeur, et fait suivre le reflet holographique. */
export function tilt(element: HTMLElement) {
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;

  let frame = 0;

  function onMove(event: PointerEvent) {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const box = element.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      element.style.setProperty('--rx', `${(0.5 - y) * 12}deg`);
      element.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
      element.style.setProperty('--mx', `${x * 100}%`);
      element.style.setProperty('--my', `${y * 100}%`);
    });
  }

  function onLeave() {
    cancelAnimationFrame(frame);
    for (const name of ['--rx', '--ry', '--mx', '--my']) element.style.removeProperty(name);
  }

  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerleave', onLeave);
  return {
    destroy() {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
    },
  };
}
