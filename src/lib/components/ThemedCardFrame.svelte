<script lang="ts">
  import { unfoldOnReveal, type CardFrameTheme } from '#lib/card-frame';
  import type { EditionKind } from '#prisma';
  import FantasyCardFrame from './FantasyCardFrame.svelte';
  import UnderworldCardFrame from './UnderworldCardFrame.svelte';

  let {
    theme,
    kind,
    reveal = false,
  }: {
    theme: CardFrameTheme;
    kind: EditionKind;
    reveal?: boolean;
  } = $props();
</script>

<span class="frame-layer" use:unfoldOnReveal={reveal} data-frame-theme={theme} aria-hidden="true">
  {#if theme === 'forest'}
    <FantasyCardFrame {kind} {reveal} />
  {:else if theme === 'underworld'}
    <UnderworldCardFrame {kind} {reveal} />
  {:else if theme === 'laboratory'}
    <span class="laboratory-frame" class:reveal data-tier={kind.toLowerCase()}>
      {#each ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as corner (corner)}
        <span class="laboratory-corner {corner}"></span>
      {/each}
    </span>
  {:else}
    <span class="maple-frame" class:reveal>
      {#each ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as corner (corner)}
        <span class="maple-corner {corner}"><span></span></span>
      {/each}
    </span>
  {/if}
</span>

<style>
  .frame-layer {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    pointer-events: none;
  }
  .maple-frame {
    position: absolute;
    inset: 0;
    border: 3px solid #18171a;
    border-radius: inherit;
    box-shadow:
      inset 0 0 0 1px #bc7544,
      inset 0 0 0 5px #4d151b,
      0 0 16px #b43b2740;
  }
  .laboratory-frame {
    position: absolute;
    inset: 0;
    border: 3px solid #162030;
    box-shadow:
      inset 0 0 0 1px #95a7b3,
      inset 0 0 0 5px #273c49;
    border-radius: inherit;
    --signal: #83e3db;
  }
  .laboratory-frame[data-tier='mythique'] {
    --signal: #5daaff;
    box-shadow:
      inset 0 0 0 1px #c7dceb,
      inset 0 0 0 5px #204465,
      0 0 19px #3a85ff46;
  }
  .laboratory-corner {
    position: absolute;
    width: clamp(16px, 9%, 70px);
    aspect-ratio: 1;
    clip-path: polygon(0 0, 100% 0, 71% 21%, 42% 21%, 21% 42%, 21% 71%, 0 100%);
    background: linear-gradient(145deg, #e1e9ed 8%, #607882 32%, var(--signal) 37%, #263340 59%);
  }
  .maple-corner {
    position: absolute;
    width: clamp(24px, 8%, 65px);
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #db925d, #641b20 24%, #251a20 62%, #ad6240);
    clip-path: polygon(0 0, 100% 0, 76% 22%, 51% 23%, 23% 51%, 22% 76%, 0 100%);
  }
  .maple-corner span {
    position: absolute;
    left: 9%;
    top: 9%;
    width: 46%;
    height: 46%;
    background: linear-gradient(140deg, #ffe4ae, #cb7760 48%, #922e38);
    clip-path: polygon(
      50% 0,
      62% 35%,
      90% 18%,
      77% 49%,
      100% 57%,
      58% 73%,
      52% 100%,
      43% 73%,
      0 57%,
      23% 49%,
      10% 18%,
      38% 35%
    );
    transform: rotate(-32deg);
  }
  .top-left {
    top: 0;
    left: 0;
  }
  .top-right {
    top: 0;
    right: 0;
    transform: rotate(90deg);
  }
  .bottom-left {
    bottom: 0;
    left: 0;
    transform: rotate(-90deg);
  }
  .bottom-right {
    bottom: 0;
    right: 0;
    transform: rotate(180deg);
  }
  .reveal {
    opacity: 0;
    transition: opacity 550ms ease-out;
  }
  .frame-layer[data-frame-open] .reveal {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .reveal {
      transition: none;
    }
  }
</style>
