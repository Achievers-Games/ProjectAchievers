<script lang="ts">
  import type { EditionKind } from '#prisma';

  let { reveal = false, kind = 'MYTHIQUE' }: { reveal?: boolean; kind?: EditionKind } = $props();
  const mythique = $derived(kind === 'MYTHIQUE');
  const relief = $derived(kind === 'RELIEF');
  const id = $props.id();
  const gold = `url(#${id}-gold)`;
  const leaf = `url(#${id}-leaf)`;
  const gem = `url(#${id}-gem)`;
  const leaves = [
    { x: 19, y: -6, angle: -76, scale: 0.84 },
    { x: 30, y: -8, angle: 22, scale: 0.7 },
    { x: 48, y: -16, angle: -64, scale: 1.1 },
    { x: 66, y: -19, angle: 20, scale: 0.82 },
    { x: 85, y: -27, angle: -48, scale: 0.93 },
    { x: 107, y: -32, angle: 5, scale: 0.77 },
    { x: 125, y: -37, angle: -27, scale: 0.96 },
  ];
  const corners = [
    'translate(12 12)',
    'translate(908 12) scale(-1 1)',
    'translate(12 588) scale(1 -1)',
    'translate(908 588) scale(-1 -1)',
  ];
  const sparks = [
    { x: 422, y: -12, dx: -28, dy: -49, delay: 0, size: 2 },
    { x: 451, y: -19, dx: -9, dy: -67, delay: 90, size: 3 },
    { x: 475, y: -15, dx: 16, dy: -60, delay: 180, size: 2 },
    { x: 495, y: -12, dx: 34, dy: -43, delay: 250, size: 2.5 },
    { x: 8, y: 276, dx: -27, dy: -66, delay: 420, size: 2 },
    { x: 910, y: 324, dx: 29, dy: -71, delay: 610, size: 2.5 },
    { x: 17, y: 558, dx: -30, dy: -60, delay: 720, size: 2.5 },
    { x: 901, y: 554, dx: 32, dy: -50, delay: 820, size: 2 },
  ];
</script>

{#snippet wing()}
  <g class="wing">
    <path
      class="grow"
      pathLength="1"
      d="M2 2 C35 1 64 -19 92 -29 S134 -38 155 -50"
      fill="none"
      stroke={gold}
      stroke-width="2.6"
    />
    {#if mythique}
      <path
        class="grow"
        pathLength="1"
        d="M6 6 C48 19 86 -8 112 -14 C131 -17 147 -18 161 -27"
        fill="none"
        stroke={gold}
        stroke-width="1"
      />
    {/if}
    {#each leaves.slice(0, mythique ? leaves.length : 4) as item, index (item.x)}
      <g transform="translate({item.x} {item.y}) rotate({item.angle}) scale({item.scale})">
        <g class="leaf" style:--i={index}>
          <path d="M0 0 Q7 -14 34 -5 Q24 12 0 0Z" fill={leaf} stroke={gold} stroke-width="1.15" />
          <path
            d="M1 0 Q14 1 28 -4 M9 0 l5 -5 M17 -1 l4 4"
            fill="none"
            stroke="#ffe0a3"
            stroke-width=".75"
          />
        </g>
      </g>
    {/each}
  </g>
{/snippet}

<svg
  class="fantasy-frame"
  class:reveal
  data-tier={kind.toLowerCase()}
  viewBox="-70 -90 1060 780"
  preserveAspectRatio={reveal ? 'none' : 'xMidYMid meet'}
  aria-hidden="true"
>
  <defs>
    <linearGradient id="{id}-gold" x2="0.75" y2="1">
      <stop stop-color="var(--metal-light)" /><stop offset=".27" stop-color="var(--metal-mid)" />
      <stop offset=".47" stop-color="var(--metal-bright)" /><stop
        offset=".67"
        stop-color="var(--metal-deep)"
      />
      <stop offset="1" stop-color="var(--metal-bright)" />
    </linearGradient>
    <linearGradient id="{id}-leaf" x2="0.15" y2="1">
      <stop stop-color="#7fbbb1" /><stop offset=".42" stop-color="#214c4c" />
      <stop offset=".53" stop-color="#183333" /><stop offset="1" stop-color="#0e262e" />
    </linearGradient>
    <linearGradient id="{id}-gem" x2=".8" y2="1">
      <stop stop-color="#ecffdf" /><stop offset=".36" stop-color="#85dace" />
      <stop offset=".72" stop-color="#326b67" /><stop offset="1" stop-color="#132d38" />
    </linearGradient>
  </defs>

  {#if !relief}<rect
      class="ring"
      x="-9"
      y="-9"
      width="938"
      height="618"
      rx="24"
      stroke={gold}
    />{/if}
  {#if mythique}<rect
      class="ring outer"
      x="-17"
      y="-17"
      width="954"
      height="634"
      rx="30"
      stroke={gold}
    />{/if}
  <rect x="4" y="4" width="912" height="592" rx="16" fill="none" stroke={gold} stroke-width="1.4" />
  <g class="contour" fill="none" stroke={gold} stroke-width={relief ? 2 : 3.4}>
    <path pathLength="1" d="M460 4H24Q4 4 4 24V576Q4 596 24 596H460" />
    <path pathLength="1" d="M460 4H896Q916 4 916 24V576Q916 596 896 596H460" />
  </g>
  {#if mythique}<rect
      class="runner"
      x="4"
      y="4"
      width="912"
      height="592"
      rx="16"
      pathLength="100"
    />{/if}

  {#each relief ? [] : corners as transform (transform)}
    <g {transform}>
      <g class="corner">
        <path
          d="M-10 56V9Q-10 -10 9 -10H62L39 -2Q12 4 5 32Z"
          fill="#152e34"
          stroke={gold}
          stroke-width="2"
        />
        <path
          d="M-16 40Q-11 3 34 -16Q32 3 14 13Q4 30 -16 40Z"
          fill={leaf}
          stroke={gold}
          stroke-width="1.5"
        />
        <path d="M-11 34Q4 8 28 -10M2 15L0 4M12 7l10 -1" fill="none" stroke="#ffd7a1" />
      </g>
    </g>
  {/each}

  {#each mythique ? [4, 916] : [] as x (x)}
    <g transform="translate({x} 300)">
      <g class="side">
        <path
          d="M0 -35 9 -11 20 0 9 11 0 35 -9 11 -20 0 -9 -11Z"
          fill="#162e35"
          stroke={gold}
          stroke-width="1.7"
        />
        <path d="M0 -14 9 0 0 14 -9 0Z" fill={gem} stroke={gold} />
      </g>
    </g>
  {/each}

  {#if !relief}
    <g transform="translate(460 5) scale({mythique ? 1 : 0.64})">
      {#if mythique}<circle
          class="shock"
          r="18"
          fill="none"
          stroke="#d4f3bf"
          stroke-width="2"
        />{/if}
      <g transform="translate(9 -6)">{@render wing()}</g>
      <g transform="translate(-9 -6) scale(-1 1)">{@render wing()}</g>
      <g class="crest">
        <path
          d="M0 -40 20 -18 19 3 0 27 -19 3 -20 -18Z"
          fill="#17272f"
          stroke={gold}
          stroke-width="2.6"
        />
        <path
          d="M0 -32 13 -14 12 1 0 17 -12 1 -13 -14Z"
          fill={gem}
          stroke="#ffe2a9"
          stroke-width="1.2"
        />
        <path d="M0 -31V16M-13 -14 0 -7 13 -14" fill="none" stroke="#ecffe3" stroke-opacity=".66" />
      </g>
    </g>
  {/if}
  {#if mythique}
    <g transform="translate(460 596)">
      <g class="pendant">
        <path
          d="M-80 0Q-29 -2 -17 11L0 32 17 11Q29 -2 80 0L41 -8H-41Z"
          fill="#192f33"
          stroke={gold}
          stroke-width="2"
        />
        <path d="M0 -5 10 9 0 22 -10 9Z" fill={gem} stroke={gold} />
      </g>
    </g>
    <g class="particles" fill="#fff0c2">
      {#each sparks as mote (mote.x)}
        <circle
          cx={mote.x}
          cy={mote.y}
          r={mote.size}
          style:--dx="{mote.dx}px"
          style:--dy="{mote.dy}px"
          style:--start="{mote.delay}ms"
        />
      {/each}
    </g>
  {/if}
</svg>

<style>
  .fantasy-frame {
    --metal-light: #fff3cf;
    --metal-mid: #a16c35;
    --metal-bright: #ffd292;
    --metal-deep: #775530;
    position: absolute;
    left: -7.609%;
    top: -15%;
    width: 115.218%;
    height: 130%;
    pointer-events: none;
    backface-visibility: hidden;
    transform: translateZ(8px);
  }
  [data-tier='relief'] {
    --metal-light: #d9e5eb;
    --metal-mid: #617989;
    --metal-bright: #b0c5d1;
    --metal-deep: #394c58;
  }
  [data-tier='vivante'] {
    --metal-light: #e0ffed;
    --metal-mid: #388781;
    --metal-bright: #a3e4c7;
    --metal-deep: #275c61;
  }
  .contour path,
  .grow {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition: stroke-dashoffset 260ms ease-in;
  }
  .runner {
    fill: none;
    stroke: #fff3cc;
    stroke-width: 2.8;
    stroke-dasharray: 7 93;
    opacity: 0;
    filter: drop-shadow(0 0 5px #ffc87b);
  }
  .ring {
    fill: none;
    stroke-width: 1.2;
    opacity: 0;
    transition: opacity 220ms ease-in;
  }
  .outer {
    stroke-dasharray: 3 6;
  }
  .wing,
  .leaf,
  .corner,
  .side,
  .crest,
  .pendant {
    transform-box: fill-box;
    transform-origin: center;
    transition:
      transform 250ms ease-in,
      opacity 180ms ease-in;
  }
  .wing {
    transform-origin: left center;
    transform: rotate(20deg) scaleX(0.65);
  }
  .leaf {
    transform-origin: left center;
    transform: scale(0.08) rotate(32deg);
    opacity: 0;
  }
  .corner,
  .side,
  .pendant {
    opacity: 0;
    transform: scale(0.28);
  }
  .crest {
    transform: scale(0.64);
  }
  .shock,
  .particles circle {
    opacity: 0;
  }
  :global([data-tilting]) .contour path,
  :global([data-frame-open]) .contour path {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 550ms ease-out;
  }
  :global([data-tilting]) .grow,
  :global([data-frame-open]) .grow {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 480ms ease-out 240ms;
  }
  :global([data-tilting]) .wing,
  :global([data-frame-open]) .wing {
    transform: none;
    transition: transform 610ms cubic-bezier(0.16, 1.15, 0.3, 1) 240ms;
  }
  :global([data-tilting]) .leaf,
  :global([data-frame-open]) .leaf {
    transform: none;
    opacity: 1;
    transition:
      transform 450ms cubic-bezier(0.23, 1.42, 0.42, 1) calc(275ms + var(--i) * 55ms),
      opacity 200ms ease calc(275ms + var(--i) * 55ms);
  }
  :global([data-tilting]) .crest,
  :global([data-frame-open]) .crest {
    transform: scale(1);
    transition: transform 500ms cubic-bezier(0.22, 1.6, 0.4, 1) 180ms;
  }
  :global([data-tilting]) .ring,
  :global([data-frame-open]) .ring {
    opacity: 0.72;
    transition: opacity 500ms ease-out 320ms;
  }
  :global([data-tilting]) .outer,
  :global([data-frame-open]) .outer {
    opacity: 0.48;
    transition-delay: 460ms;
  }
  :global([data-tilting]) :is(.corner, .side, .pendant),
  :global([data-frame-open]) :is(.corner, .side, .pendant) {
    opacity: 1;
    transform: none;
    transition:
      transform 470ms cubic-bezier(0.19, 1.45, 0.4, 1) var(--arrival, 430ms),
      opacity 260ms ease var(--arrival, 430ms);
  }
  .side {
    --arrival: 560ms;
  }
  .pendant {
    --arrival: 120ms;
  }
  :global([data-tilting]) .runner,
  :global([data-frame-open]) .runner {
    animation: lap 3.2s linear 950ms infinite;
  }
  :global([data-tilting]) .shock,
  :global([data-frame-open]) .shock {
    animation: ripple 620ms ease-out 220ms both;
  }
  :global([data-tilting]) .particles circle,
  :global([data-frame-open]) .particles circle {
    animation: drift 2s ease-out calc(260ms + var(--start)) infinite both;
  }
  @keyframes lap {
    0% {
      stroke-dashoffset: 0;
      opacity: 0;
    }
    10%,
    90% {
      opacity: 0.94;
    }
    100% {
      stroke-dashoffset: -100;
      opacity: 0;
    }
  }
  @keyframes ripple {
    from {
      transform: scale(0.6);
      opacity: 0.8;
    }
    to {
      transform: scale(2.8);
      opacity: 0;
    }
  }
  @keyframes drift {
    0% {
      opacity: 0;
    }
    14% {
      opacity: 0.92;
    }
    78%,
    100% {
      transform: translate(var(--dx), var(--dy)) scale(0.6);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fantasy-frame * {
      transition: none !important;
      animation: none !important;
    }
    .leaf,
    .corner,
    .side,
    .crest,
    .pendant,
    .wing {
      transform: none;
      opacity: 1;
    }
    .grow,
    .contour path {
      stroke-dashoffset: 0;
    }
    .ring {
      opacity: 0.6;
    }
  }
  @media (hover: none) {
    .fantasy-frame:not(.reveal) :is(.leaf, .corner, .side, .crest, .pendant, .wing) {
      transform: none;
      opacity: 1;
    }
    .fantasy-frame:not(.reveal) :is(.grow, .contour path) {
      stroke-dashoffset: 0;
    }
  }
</style>
