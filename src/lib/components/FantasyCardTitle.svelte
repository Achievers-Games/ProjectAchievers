<script lang="ts">
  import { unfoldOnReveal, type CardFrameTheme } from '#lib/card-frame';
  import type { EditionKind } from '#prisma';

  let {
    name,
    compact = false,
    reveal = false,
    kind = 'MYTHIQUE',
    theme = 'forest',
  }: {
    name: string;
    compact?: boolean;
    reveal?: boolean;
    kind?: EditionKind;
    theme?: CardFrameTheme;
  } = $props();
  const leaves = [
    { x: 14, y: 29, rotate: -75 },
    { x: 23, y: 25, rotate: 25 },
    { x: 32, y: 21, rotate: -63 },
    { x: 42, y: 17, rotate: 18 },
    { x: 52, y: 13, rotate: -50 },
  ];
</script>

{#snippet sprig(right: boolean)}
  <svg class="engraving" class:right viewBox="0 0 72 42" aria-hidden="true">
    <path class="stem" pathLength="1" d="M4 34C25 27 40 17 67 7" />
    {#each leaves.slice(0, kind === 'MYTHIQUE' ? 5 : kind === 'VIVANTE' ? 3 : 0) as leaf, index (leaf.x)}
      <g transform="translate({leaf.x} {leaf.y}) rotate({leaf.rotate})">
        <g class="leaf" style:--i={index}>
          <path class="blade" d="M0 0Q5-8 16-3Q11 7 0 0Z" />
          <path class="vein" d="M1 0Q8 0 13-2" />
        </g>
      </g>
    {/each}
  </svg>
{/snippet}

<span
  class="fantasy-title"
  data-tier={kind.toLowerCase()}
  class:underworld={theme === 'underworld'}
  class:compact
  use:unfoldOnReveal={reveal}
>
  <span class="plate">
    <span class="inlay"></span>
    {#if theme === 'forest'}
      {@render sprig(false)}
      {@render sprig(true)}
    {:else}
      {#each [false, true] as right (right)}
        <svg class="engraving" class:right viewBox="0 0 72 42" aria-hidden="true">
          <path class="stem" pathLength="1" d="M5 30H24V11H43V30H58V17H49V23" />
          {#if kind !== 'RELIEF'}<path class="inset-line" d="M5 36H30V17H37V36H61" />{/if}
        </svg>
      {/each}
    {/if}
    <strong>{name}</strong>
  </span>
</span>

<style>
  .fantasy-title {
    position: absolute;
    z-index: 3;
    inset: auto 12% 5%;
    display: block;
    color: #fff1ce;
    text-align: center;
    filter: drop-shadow(0 3px 6px #000c);
    --plate-cut: polygon(
      0 50%,
      4% 16%,
      10% 16%,
      13% 0,
      87% 0,
      90% 16%,
      96% 16%,
      100% 50%,
      96% 84%,
      90% 84%,
      87% 100%,
      13% 100%,
      10% 84%,
      4% 84%
    );
  }
  .plate {
    display: grid;
    position: relative;
    place-items: center;
    min-height: clamp(40px, 6.2vw, 75px);
    padding: 0.5em 13%;
    clip-path: var(--plate-cut);
    background: linear-gradient(166deg, #ffe9b9, #8e5d30 32%, #f1c283 49%, #684520 75%, #e3b87c);
  }
  [data-tier='relief'] .plate {
    background: linear-gradient(166deg, #e3eef5, #566a78 32%, #b0c5d1 49%, #33434c 75%, #9dabba);
  }
  [data-tier='vivante'] .plate {
    background: linear-gradient(166deg, #e4fff1, #388781 32%, #a3e4c7 49%, #235355 75%, #85c8b2);
  }
  [data-tier='relief'] .stem {
    stroke: #b0c5d1;
  }
  [data-tier='vivante'] .stem,
  [data-tier='vivante'] .blade {
    stroke: #a3e4c7;
  }
  .underworld {
    --plate-cut: polygon(0 50%, 6% 0, 94% 0, 100% 50%, 94% 100%, 6% 100%);
  }
  .underworld .plate {
    background: linear-gradient(172deg, #f7cca9, #75422d 33%, #c27951 51%, #4c2422 76%, #b47552);
  }
  .underworld[data-tier='mythique'] .plate {
    background: linear-gradient(170deg, #ffe1a1, #8e402e 34%, #ffad70 51%, #562024 77%, #dd8b53);
  }
  .underworld .inlay {
    background: linear-gradient(169deg, #43252c, #170f17 64%, #251722);
    box-shadow: inset 0 0 0 3px #c07d5645;
  }
  .underworld .stem {
    stroke: #f0ad77;
  }
  .inset-line {
    fill: none;
    stroke: #865044;
    stroke-width: 1.25;
  }
  .inlay {
    position: absolute;
    inset: 2px;
    clip-path: var(--plate-cut);
    background:
      radial-gradient(ellipse at 50% 0, #a9c7ae30, transparent 70%),
      linear-gradient(165deg, #28474b, #101f27 48%, #132e33);
    box-shadow: inset 0 0 0 3px #c99d6250;
  }
  .engraving {
    position: absolute;
    left: 3.5%;
    width: 11%;
    height: 90%;
    overflow: visible;
    pointer-events: none;
  }
  .engraving.right {
    left: auto;
    right: 3.5%;
    transform: scaleX(-1);
  }
  .stem {
    fill: none;
    stroke: #d4ae6f;
    stroke-width: 1.45;
    stroke-dasharray: 1;
    stroke-dashoffset: 0.37;
    transition: stroke-dashoffset 270ms ease;
  }
  .leaf {
    transform-box: fill-box;
    transform-origin: left center;
    transform: rotate(28deg) scale(0.48);
    opacity: 0.58;
    transition:
      transform 240ms ease-in,
      opacity 180ms ease-in;
  }
  .blade {
    fill: #35655f;
    stroke: #e4bb78;
    stroke-width: 1.05;
  }
  .vein {
    fill: none;
    stroke: #fff0ba;
    stroke-width: 0.7;
  }
  .fantasy-title:global([data-frame-open]) .stem,
  :global([data-tilting]) .stem {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 420ms ease-out 180ms;
  }
  .fantasy-title:global([data-frame-open]) .leaf,
  :global([data-tilting]) .leaf {
    transform: none;
    opacity: 1;
    transition:
      transform 400ms cubic-bezier(0.18, 1.45, 0.42, 1) calc(260ms + var(--i) * 65ms),
      opacity 190ms ease-out calc(260ms + var(--i) * 65ms);
  }
  @media (prefers-reduced-motion: reduce), (hover: none) {
    .fantasy-title .stem,
    .fantasy-title .leaf {
      stroke-dashoffset: 0;
      transform: none;
      opacity: 1;
      transition: none;
    }
  }
  @media (hover: none) and (prefers-reduced-motion: no-preference) {
    .fantasy-title:global([data-frame-open]) .stem {
      animation: trace-stem 420ms ease-out 180ms both;
    }
    .fantasy-title:global([data-frame-open]) .leaf {
      animation: grow-leaf 400ms cubic-bezier(0.18, 1.45, 0.42, 1) calc(260ms + var(--i) * 65ms)
        both;
    }
  }
  @keyframes trace-stem {
    from {
      stroke-dashoffset: 0.37;
    }
  }
  @keyframes grow-leaf {
    from {
      transform: rotate(28deg) scale(0.48);
      opacity: 0.58;
    }
  }
  strong {
    position: relative;
    font-family: 'Cinzel', Georgia, serif;
    font-size: clamp(12px, 1.7vw, 23px);
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: 0.025em;
    text-shadow: 0 2px 4px #030809;
  }
  .compact .plate {
    min-height: clamp(22px, 3.1vw, 36px);
    padding-block: 3px;
  }
  .compact strong {
    font-size: clamp(8px, 0.9vw, 13px);
  }
</style>
