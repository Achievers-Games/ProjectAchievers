<script lang="ts">
  import type { EditionKind } from '#prisma';

  let { kind, reveal }: { kind: EditionKind; reveal: boolean } = $props();
  const id = $props.id();
  const metal = `url(#${id}-metal)`;
  const coal = `url(#${id}-coal)`;
  const ember = `url(#${id}-ember)`;
  const corners = [
    'translate(8 8)',
    'translate(912 8) scale(-1 1)',
    'translate(8 592) scale(1 -1)',
    'translate(912 592) scale(-1 -1)',
  ];
  const sparks = [
    { x: 16, y: 98, dx: -21, dy: -38, delay: 40 },
    { x: 36, y: 16, dx: -8, dy: -47, delay: 350 },
    { x: 886, y: 19, dx: 8, dy: -47, delay: 150 },
    { x: 908, y: 111, dx: 23, dy: -43, delay: 540 },
    { x: 20, y: 546, dx: -21, dy: -53, delay: 810 },
    { x: 905, y: 545, dx: 25, dy: -54, delay: 950 },
  ];
</script>

<svg
  class="underworld-frame"
  class:reveal
  data-tier={kind.toLowerCase()}
  viewBox="-70 -90 1060 780"
  preserveAspectRatio={reveal ? 'none' : 'xMidYMid meet'}
  aria-hidden="true"
>
  <defs>
    <linearGradient id="{id}-metal" x2=".65" y2="1">
      <stop stop-color="var(--metal-light)" />
      <stop offset=".3" stop-color="#6f3d28" />
      <stop offset=".53" stop-color="var(--metal-light)" />
      <stop offset=".76" stop-color="#391c1b" />
      <stop offset="1" stop-color="#b6794a" />
    </linearGradient>
    <linearGradient id="{id}-coal" x2=".6" y2="1">
      <stop stop-color="#4d2428" /><stop offset=".48" stop-color="#19141c" /><stop
        offset="1"
        stop-color="#09090e"
      />
    </linearGradient>
    <linearGradient id="{id}-ember" x2=".7" y2="1">
      <stop stop-color="#ffe1a1" /><stop offset=".48" stop-color="#f9743e" /><stop
        offset="1"
        stop-color="#911e29"
      />
    </linearGradient>
  </defs>
  <path
    d="M30 4H890L916 30V570L890 596H30L4 570V30Z"
    fill="none"
    stroke="#371c19"
    stroke-width="7"
  />
  <path d="M30 4H890L916 30V570L890 596H30L4 570V30Z" fill="none" stroke={metal} stroke-width="2" />
  <g class="etch" fill="none" stroke="#a76c50" stroke-width="1.6">
    {#each [42, 842] as x (x)}
      <path d="M{x} 14h16v6h10v-5h-6v-4h16v9h10v-6h16M{x} 586h16v-6h10v5h-6v4h16v-9h10v6h16" />
    {/each}
  </g>
  <g class="trace" fill="none" stroke={ember} stroke-width="2.6">
    <path pathLength="1" d="M460 4H30L4 30V570L30 596H460" />
    <path pathLength="1" d="M460 4H890L916 30V570L890 596H460" />
  </g>

  {#if kind !== 'RELIEF'}
    {#each corners as transform (transform)}
      <g {transform}>
        <g class="corner">
          <path
            d="M-16 64-16 19 19-16 85-16 62 5 36 11 11 36 5 62Z"
            fill={coal}
            stroke={metal}
            stroke-width="2.6"
          />
          <path
            d="M-8 46V21L21-8H60L43 1H25L1 25V43Z"
            fill="none"
            stroke="#b97755"
            stroke-width="1.7"
          />
          <path
            class="fracture"
            pathLength="1"
            d="M-12 50 4 32-1 23 26 8 22 0 54-10M26 8l15 1 11-8"
            fill="none"
            stroke={ember}
            stroke-width="2.4"
          />
          <path d="M6 21 21 6 34 8 28 21 16 28Z" fill={coal} stroke="#81372c" />
        </g>
      </g>
    {/each}
  {/if}

  {#if kind === 'MYTHIQUE'}
    <path
      class="outer"
      d="M24-13H896L933 24V576L896 613H24L-13 576V24Z"
      fill="none"
      stroke={metal}
      stroke-width="1.5"
      stroke-dasharray="21 5 3 5"
    />
    <g transform="translate(460 7)">
      <g class="crest">
        <path
          d="M-141-2-105-29-55-29-29-48-13-43 0-67 13-43 29-48 55-29 105-29 141-2 87-4 56 6 29 3 0 34-29 3-56 6-87-4Z"
          fill={coal}
          stroke={metal}
          stroke-width="3.1"
        />
        <path
          d="M-119-9h20v-9h20v9h-9v-4h-6v9h31L-30-26M119-9H99v-9H79v9h9v-4h6v9H63L30-26"
          fill="none"
          stroke="#d19862"
          stroke-width="1.9"
        />
        <path
          class="coal"
          d="M0-49 17-26 15-5 0 12-15-5-17-26Z"
          fill={ember}
          stroke="#ffd29a"
          stroke-width="1.6"
        />
        <path d="M0-44v51M-14-25 0-17l14-8" fill="none" stroke="#fff4c9" stroke-opacity=".68" />
      </g>
    </g>
    {#each [0, 920] as x (x)}
      <g transform="translate({x} 300)">
        <g class="side">
          <path
            d="M0-55 14-29 25 0 14 29 0 55-14 29-25 0-14-29Z"
            fill={coal}
            stroke={metal}
            stroke-width="2.4"
          />
          <path
            class="fracture"
            pathLength="1"
            d="M0-38 8-17-5-3 8 11 0 37"
            fill="none"
            stroke={ember}
            stroke-width="2.8"
          />
        </g>
      </g>
    {/each}
    <g class="sparks">
      {#each sparks as spark (spark.delay)}
        <circle
          cx={spark.x}
          cy={spark.y}
          r="2.4"
          fill="#ffad62"
          style:--dx="{spark.dx}px"
          style:--dy="{spark.dy}px"
          style:--wait="{spark.delay}ms"
        />
      {/each}
    </g>
  {/if}
</svg>

<style>
  .underworld-frame {
    --metal-light: #cf9a80;
    position: absolute;
    left: -7.609%;
    top: -15%;
    width: 115.218%;
    height: 130%;
    transform: translateZ(8px);
    backface-visibility: hidden;
    pointer-events: none;
  }
  [data-tier='vivante'] {
    --metal-light: #e1a273;
  }
  [data-tier='mythique'] {
    --metal-light: #ffce90;
  }
  .trace path,
  .fracture {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition: stroke-dashoffset 260ms ease-in;
  }
  .corner,
  .crest,
  .side {
    transform-box: fill-box;
    transform-origin: center;
    transform: scale(0.42);
    opacity: 0;
    transition:
      transform 270ms ease-in,
      opacity 210ms ease-in;
  }
  .corner {
    --arrival: 310ms;
  }
  .crest {
    --arrival: 180ms;
  }
  .side {
    --arrival: 510ms;
  }
  .outer,
  .sparks circle {
    opacity: 0;
  }
  .outer {
    transition: opacity 240ms ease-in;
  }
  :global([data-tilting]) .trace path,
  :global([data-frame-open]) .trace path {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 530ms ease-out;
  }
  :global([data-tilting]) :is(.corner, .crest, .side),
  :global([data-frame-open]) :is(.corner, .crest, .side) {
    opacity: 1;
    transform: none;
    transition:
      transform 410ms cubic-bezier(0.18, 1.35, 0.4, 1) var(--arrival),
      opacity 240ms ease-out var(--arrival);
  }
  :global([data-tilting]) .fracture,
  :global([data-frame-open]) .fracture {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 620ms ease-out 480ms;
    filter: drop-shadow(0 0 3px #fa512d);
  }
  :global([data-tilting]) .outer,
  :global([data-frame-open]) .outer {
    opacity: 0.8;
    transition: opacity 540ms ease-out 400ms;
  }
  :global([data-tilting]) .coal,
  :global([data-frame-open]) .coal {
    animation: heat 2.1s ease-in-out 700ms infinite alternate;
  }
  :global([data-tilting]) .sparks circle,
  :global([data-frame-open]) .sparks circle {
    animation: escape 1.8s ease-out calc(650ms + var(--wait)) infinite both;
  }
  @keyframes heat {
    from {
      filter: drop-shadow(0 0 3px #f76332);
    }
    to {
      filter: drop-shadow(0 0 13px #ff7b39);
    }
  }
  @keyframes escape {
    10% {
      opacity: 0.9;
    }
    80%,
    100% {
      opacity: 0;
      transform: translate(var(--dx), var(--dy));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .underworld-frame * {
      animation: none !important;
      transition: none !important;
    }
    .underworld-frame :is(.corner, .crest, .side, .outer) {
      opacity: 1;
      transform: none;
    }
    .underworld-frame :is(.trace path, .fracture) {
      stroke-dashoffset: 0;
    }
  }
  @media (hover: none) {
    .underworld-frame:not(.reveal) :is(.corner, .crest, .side, .outer) {
      opacity: 1;
      transform: none;
    }
    .underworld-frame:not(.reveal) :is(.trace path, .fracture) {
      stroke-dashoffset: 0;
    }
  }
</style>
