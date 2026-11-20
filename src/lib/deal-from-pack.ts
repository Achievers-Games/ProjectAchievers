interface DealOptions {
  from: { x: number; y: number; width: number; height: number } | null;
  index: number;
  count: number;
  enabled: boolean;
}

export const DEAL_DURATION = 1200;
export const DEAL_STAGGER = 100;

/** Move the actual card from inside the packet, through its mouth, to its final layout slot. */
export function dealFromPack(node: HTMLElement, options: DealOptions) {
  if (!options.enabled || !options.from) return;
  const source = options.from;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches) return;
  let animation: Animation | undefined;
  node.style.visibility = 'hidden';
  const frame = requestAnimationFrame(() => {
    const target = node.getBoundingClientRect();
    const cardHeight = node.querySelector('.card')?.getBoundingClientRect().height ?? target.height;
    const targetX = target.x + target.width / 2;
    const targetY = target.y + cardHeight / 2;
    node.style.transformOrigin = `50% ${cardHeight / 2}px`;
    const scale = Math.min(
      (source.width * 0.72) / target.width,
      (source.height * 0.72) / cardHeight,
    );
    const fan = options.index - (options.count - 1) / 2;
    const pose = (x: number, y: number, size: number, angle: number) =>
      `translate(${x - targetX}px, ${y - targetY}px) scale(${size}) rotate(${angle}deg)`;
    animation = node.animate(
      [
        {
          offset: 0,
          transform: pose(source.x + source.width * 0.5, source.y + source.height * 0.5, scale, 0),
          opacity: 1,
          easing: 'cubic-bezier(0.35, 0, 0.65, 1)',
        },
        {
          offset: 0.34,
          easing: 'cubic-bezier(0.35, 0, 0.65, 1)',
          transform: pose(
            source.x + source.width + target.width * scale * 0.28,
            source.y + source.height * 0.43,
            scale,
            -5 + fan * 2,
          ),
        },
        {
          offset: 0.65,
          easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)',
          transform: pose(
            source.x + source.width / 2 + fan * Math.min(55, source.width * 0.08),
            source.y - cardHeight * 0.22,
            0.9,
            fan * 7,
          ),
        },
        { offset: 1, transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      ],
      {
        duration: DEAL_DURATION,
        delay: options.index * DEAL_STAGGER,
        easing: 'linear',
        fill: 'backwards',
      },
    );
    node.style.visibility = '';
  });
  function finish() {
    animation?.finish();
    node.style.visibility = '';
  }
  window.addEventListener('resize', finish);
  motion.addEventListener('change', finish);
  return {
    update(next: DealOptions) {
      if (!next.enabled) finish();
    },
    destroy() {
      cancelAnimationFrame(frame);
      animation?.cancel();
      node.style.visibility = '';
      window.removeEventListener('resize', finish);
      motion.removeEventListener('change', finish);
    },
  };
}
