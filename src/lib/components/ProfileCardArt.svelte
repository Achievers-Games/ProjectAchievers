<script lang="ts">
  import { onMount } from 'svelte';
  import { animatedCard, levelFor } from '#lib/animated-card';
  import type { EditionKind } from '#prisma';

  let { assetPath, kind }: { assetPath: string; kind: EditionKind } = $props();
  let animate = $state(false);

  onMount(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => (animate = !preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  });
</script>

{#if animate && assetPath}
  <div class="art" aria-hidden="true">
    <canvas use:animatedCard={{ assetPath, level: levelFor(kind) }}></canvas>
  </div>
{/if}

<style>
  .art {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
  }
  .art:has(canvas:global([data-ready]))::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(0deg, rgb(8 6 18 / 0.85), rgb(8 6 18 / 0.2) 70%),
      linear-gradient(90deg, rgb(8 6 18 / 0.9) 10%, rgb(8 6 18 / 0.35));
  }
  canvas {
    position: absolute;
    top: 50%;
    left: 0;
    width: 100%;
    aspect-ratio: 460 / 215;
    transform: translateY(-50%);
    opacity: 0;
    transition: opacity 250ms ease;
  }
  canvas:global([data-ready]) {
    opacity: 1;
  }
</style>
