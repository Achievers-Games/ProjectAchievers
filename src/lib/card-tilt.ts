/** One stable pointer plane and one time-based smoothing pass for frame, light and artwork. */
export function cardTilt(node: HTMLElement, enabled = true) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let lastTime = 0;
  let x = 0;
  let y = 0;
  let hover = 0;
  let targetX = 0;
  let targetY = 0;
  let targetHover = 0;
  node.dataset.cardMotion = '';

  function paint() {
    node.style.setProperty('--tilt-x', `${-y * 5.5}deg`);
    node.style.setProperty('--tilt-y', `${x * 7}deg`);
    node.style.setProperty('--hover-lift', `${-hover * 4}px`);
    node.style.setProperty('--shine', `${hover}`);
    node.style.setProperty('--light-x', `${50 + x * 50}%`);
    node.style.setProperty('--light-y', `${50 + y * 50}%`);
    node.style.setProperty('--foil-x', `${50 + x * 30}%`);
    node.style.setProperty('--light-angle', `${100 + (x - y) * 22}deg`);
    node.style.setProperty('--parallax-x', `${x * 2}px`);
    node.style.setProperty('--parallax-y', `${y * 1.5}px`);
    const look = { x: x * 0.6, y: y * 0.6 };
    node.style.setProperty('--look-x', `${look.x}`);
    node.style.setProperty('--look-y', `${look.y}`);
    node.dispatchEvent(new CustomEvent('achievers:card-motion', { detail: look }));
  }
  function tick(now: number) {
    const dt = lastTime ? Math.min(250, now - lastTime) : 16;
    lastTime = now;
    const blend = 1 - Math.exp(-dt / 65);
    x += (targetX - x) * blend;
    y += (targetY - y) * blend;
    hover += (targetHover - hover) * blend;
    const settled =
      Math.abs(targetX - x) + Math.abs(targetY - y) + Math.abs(targetHover - hover) < 0.002;
    if (settled) {
      x = targetX;
      y = targetY;
      hover = targetHover;
    }
    paint();
    if (!settled) frame = requestAnimationFrame(tick);
    else {
      frame = lastTime = 0;
      if (!targetHover) node.removeAttribute('data-tilting');
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function rest() {
    targetX = targetY = targetHover = 0;
    schedule();
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = lastTime = 0;
    x = y = hover = targetX = targetY = targetHover = 0;
    node.removeAttribute('data-tilting');
    paint();
  }

  function move(event: PointerEvent) {
    if (!enabled || media.matches || event.pointerType === 'touch') return;
    if (node.hasAttribute('data-dragging')) {
      stop();
      return;
    }
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Saturate smoothly at the edges instead of amplifying small pointer changes.
    const axis = (position: number, start: number, length: number) =>
      Math.sin((Math.max(-1, Math.min(1, ((position - start) / length) * 2 - 1)) * Math.PI) / 2);
    targetX = axis(event.clientX, rect.left, rect.width);
    targetY = axis(event.clientY, rect.top, rect.height);
    targetHover = 1;
    node.dataset.tilting = '';
    schedule();
  }

  const motionChanged = () => {
    if (media.matches) stop();
  };
  paint();
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', rest);
  node.addEventListener('pointercancel', rest);
  node.addEventListener('focusout', rest);
  media.addEventListener('change', motionChanged);
  return {
    update(value: boolean) {
      enabled = value;
      if (!enabled) stop();
    },
    destroy() {
      stop();
      delete node.dataset.cardMotion;
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', rest);
      node.removeEventListener('pointercancel', rest);
      node.removeEventListener('focusout', rest);
      media.removeEventListener('change', motionChanged);
    },
  };
}
