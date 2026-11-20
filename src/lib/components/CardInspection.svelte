<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { m } from '#lib/paraglide/messages';
  import { animatedCard, levelFor } from '#lib/animated-card';
  import { cardTilt } from '#lib/card-tilt';
  import CardBack from './CardBack.svelte';
  import ThemedCardFrame from './ThemedCardFrame.svelte';
  import { cardFrameTheme } from '#lib/card-frame';
  import FantasyCardTitle from './FantasyCardTitle.svelte';
  import type { EditionKind } from '#prisma';

  interface InspectionCard {
    kind: EditionKind;
    game: { name: string; headerUrl: string | null } | null;
    assetPath?: string | null;
  }
  let {
    card,
    position,
    total,
    onclose,
    onprevious,
    onnext,
    status = null,
    onreplay,
    onreveal,
    actions,
  }: {
    card: InspectionCard;
    position: number;
    total: number;
    onclose: () => void;
    onprevious?: () => void;
    onnext?: () => void;
    /** La ligne sous la carte : nouvelle ou doublon à l'ouverture, date d'obtention ailleurs. */
    status?: string | null;
    onreplay?: () => void;
    /** Rejoue la scène de la Mythique ; sans elle, le bouton n'apparaît pas. */
    onreveal?: () => void;
    actions?: Snippet;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  const inspectionId = $props.id();
  const crystalGradient = `${inspectionId}-divider-crystal`;
  const dividerLeaves = [
    { x: 269, y: 11, angle: 37 },
    { x: 249, y: 10, angle: -39 },
    { x: 223, y: 11, angle: 32 },
    { x: 196, y: 15, angle: -38 },
    { x: 166, y: 18, angle: 32 },
    { x: 132, y: 20, angle: -31 },
  ];
  let canvas = $state<HTMLCanvasElement>();
  let art = $state<HTMLDivElement>();
  let showBack = $state(false);
  let replayKey = $state(0);
  const edition = $derived(card.kind.toLowerCase());
  const frameTheme = $derived(cardFrameTheme(card.assetPath));
  const leafCount = $derived(card.kind === 'MYTHIQUE' ? 6 : card.kind === 'VIVANTE' ? 3 : 0);
  const editionName = $derived(
    card.kind === 'MYTHIQUE'
      ? m.edition_mythique()
      : card.kind === 'VIVANTE'
        ? m.edition_vivante()
        : m.edition_relief(),
  );
  $effect(() => {
    void card;
    showBack = false;
    restartArt();
  });
  /** L'éveil de la Vivante est porté par l'illustration elle-même : on relance son animation. */
  function restartArt() {
    for (const animation of art?.getAnimations() ?? []) {
      animation.cancel();
      animation.play();
    }
  }

  onMount(() => {
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  });
  function cancel(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    onclose();
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' && total > 1) {
      event.preventDefault();
      event.stopPropagation();
      onprevious?.();
    }
    if (event.key === 'ArrowRight' && total > 1) {
      event.preventDefault();
      event.stopPropagation();
      onnext?.();
    }
  }
  function replay() {
    showBack = false;
    replayKey++;
    restartArt();
    canvas?.dispatchEvent(new Event('achievers:card-replay'));
    onreplay?.();
  }
</script>

<dialog
  bind:this={dialog}
  class="inspection-dialog"
  aria-label={m.booster_inspect({ name: card.game?.name ?? '—' })}
  oncancel={cancel}
  onkeydown={keyboard}
  onclick={(event) => {
    if (event.target === dialog) onclose();
  }}
>
  <div class="inspection-shell">
    <button type="button" class="inspection-close" onclick={onclose} aria-label={m.reveal_close()}
      >×</button
    >
    <header class="inspection-heading" aria-live="polite">
      <span class="eyebrow"
        >{editionName}{#if total > 1}<span class="eyebrow-dot" aria-hidden="true">·</span>{position} /
          {total}{/if}</span
      >
      <h2>{card.game?.name ?? '—'}</h2>
    </header>

    <div
      class="inspection-plane"
      class:has-frame={frameTheme !== null}
      data-frame-theme={frameTheme ?? undefined}
      use:cardTilt
      data-edition={edition}
    >
      <div class="inspection-tilt">
        <div class="inspection-flipper" class:show-back={showBack}>
          <div
            class="inspection-front"
            data-frame-theme={frameTheme ?? undefined}
            data-card-suspended={showBack ? '' : undefined}
            aria-hidden="true"
          >
            <div class="inspection-art" bind:this={art}>
              {#key card}
                {#if card.game?.headerUrl}<img
                    src={card.game.headerUrl}
                    alt=""
                    draggable="false"
                  />{:else}<span class="empty-art">✦</span>{/if}
                {#if card.assetPath}<canvas
                    bind:this={canvas}
                    use:animatedCard={{ assetPath: card.assetPath, level: levelFor(card.kind) }}
                  ></canvas>{/if}
              {/key}
              {#key replayKey}
                {#if card.kind === 'VIVANTE'}<span class="inspection-wake"></span>
                {:else if card.kind === 'MYTHIQUE'}<span class="inspection-sheen"></span>{/if}
              {/key}
            </div>
            {#if frameTheme === 'forest'}
              <svg
                class="fantasy-divider"
                viewBox="0 0 600 32"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {#each [false, true] as mirrored (mirrored)}
                  <g transform={mirrored ? 'translate(600 0) scale(-1 1)' : undefined}>
                    <path class="divider-line" d="M288 19C264 4 235 8 201 14S111 23 18 16" />
                    <path
                      class="divider-glint"
                      pathLength="1"
                      d="M288 19C264 4 235 8 201 14S111 23 18 16"
                    />
                    {#each dividerLeaves.slice(0, leafCount) as leaf, index (leaf.x)}
                      <g transform="translate({leaf.x} {leaf.y}) rotate({leaf.angle})">
                        <g class="divider-leaf" style:--leaf-step={index}>
                          <path d="M0 0Q-7 -5 -22 0Q-13 7 0 0Z" />
                          <path class="divider-vein" d="M-2 0Q-9 1 -18 0" />
                        </g>
                      </g>
                    {/each}
                  </g>
                {/each}
              </svg>
              {#if card.kind === 'MYTHIQUE'}
                <svg class="divider-crystal" viewBox="-26 -28 52 56" aria-hidden="true">
                  <defs>
                    <linearGradient id={crystalGradient} x2=".8" y2="1">
                      <stop stop-color="#efffe1" />
                      <stop offset=".35" stop-color="#8fe1d1" />
                      <stop offset=".74" stop-color="#397b77" />
                      <stop offset="1" stop-color="#173440" />
                    </linearGradient>
                  </defs>
                  <circle
                    class="divider-wave"
                    r="11"
                    fill="none"
                    stroke="#ffe8a8"
                    stroke-width="1.7"
                  />
                  <g class="divider-center">
                    <path
                      d="M0 -24 16 -9 14 9 0 23 -14 9 -16 -9Z"
                      fill="#172a31"
                      stroke="#e5ba78"
                      stroke-width="2.1"
                    />
                    <path
                      d="M0 -18 11 -7 10 7 0 17 -10 7 -11 -7Z"
                      fill="url(#{crystalGradient})"
                      stroke="#ffe6a7"
                      stroke-width="1.2"
                    />
                    <path
                      d="M0 -18V17M-11 -7 0 -2 11 -7"
                      fill="none"
                      stroke="#efffe4"
                      stroke-opacity=".75"
                    />
                  </g>
                </svg>
              {/if}
              <FantasyCardTitle name={card.game?.name ?? '—'} kind={card.kind} />
            {:else if frameTheme === 'underworld'}
              <svg
                class="underworld-divider"
                viewBox="0 0 600 32"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {#each [false, true] as mirror (mirror)}
                  <g transform={mirror ? 'translate(600 0) scale(-1 1)' : undefined}>
                    {#snippet meander()}
                      <path pathLength="1" d="M285 16H252V8H216V24H184V12H168V20H141V15H34" />
                    {/snippet}
                    <g class="underworld-etch">{@render meander()}</g>
                    <g class="underworld-heat">{@render meander()}</g>
                    {#if card.kind === 'MYTHIQUE'}
                      <path
                        class="underworld-etch fine"
                        d="M279 23H243V15H224V30H177M151 25H117V21H75"
                      />
                    {/if}
                  </g>
                {/each}
              </svg>
              {#if card.kind !== 'RELIEF'}
                <svg class="underworld-coal" viewBox="-26 -20 52 40" aria-hidden="true">
                  <path
                    d="M-24 0-12-9 0-17 12-9 24 0 12 9 0 17-12 9Z"
                    fill="#251719"
                    stroke="#c38356"
                    stroke-width="1.6"
                  />
                  <path
                    class="underworld-core"
                    d="M0-12 12 0 0 12-12 0Z"
                    fill="#eb7046"
                    stroke="#ffca88"
                    stroke-width="1.25"
                  />
                  <path
                    d="M0-10 3 0 0 10M-10 0H10"
                    fill="none"
                    stroke="#ffe6a9"
                    stroke-opacity=".82"
                  />
                </svg>
              {/if}
              <FantasyCardTitle name={card.game?.name ?? '—'} kind={card.kind} theme={frameTheme} />
            {:else}
              <span class="inspection-star">✦</span>
              <span class="inspection-etch"></span>
              <span class="inspection-plaque"
                ><strong>{card.game?.name ?? '—'}</strong><span>{editionName}</span></span
              >
              <span class="inspection-reflection"></span>
            {/if}
            {#if card.kind === 'RELIEF'}{#key replayKey}<span class="inspection-glint"
                ></span>{/key}{/if}
          </div>
          <div class="inspection-back" aria-hidden="true"><CardBack edition={card.kind} /></div>
          {#if frameTheme && !showBack}<ThemedCardFrame theme={frameTheme} kind={card.kind} />{/if}
        </div>
      </div>
    </div>

    {#if status}<p class="inspection-status">{status}</p>{/if}
    <div class="inspection-controls">
      <button
        type="button"
        class="btn"
        onclick={() => (showBack = !showBack)}
        aria-pressed={showBack}>{showBack ? m.booster_show_front() : m.booster_show_back()}</button
      >
      <button type="button" class="btn btn-primary" onclick={replay}>{m.booster_replay()}</button>
      {#if card.kind === 'MYTHIQUE' && onreveal}<button type="button" class="btn" onclick={onreveal}
          >{m.booster_reveal_again()}</button
        >{/if}
    </div>
    {#if actions}
      <div class="inspection-actions">
        {@render actions()}
      </div>
    {/if}
    {#if total > 1}
      <nav class="inspection-nav" aria-label={m.games_collection()}>
        <button type="button" onclick={onprevious} aria-label={m.booster_previous()}>←</button>
        <span>{position} / {total}</span>
        <button type="button" onclick={onnext} aria-label={m.booster_next()}>→</button>
      </nav>
    {/if}
  </div>
</dialog>

<style>
  .inspection-dialog {
    position: fixed;
    inset: 0;
  }
  .inspection-dialog {
    width: 100%;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    color: #edfaff;
    background: radial-gradient(ellipse at 50% 40%, #133743e8, #050910f5 70%);
    overflow: auto;
  }
  .inspection-dialog::backdrop {
    background: #010309c9;
  }
  .inspection-shell {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 4.5rem 1rem 2rem;
    pointer-events: none;
  }
  .inspection-shell > * {
    pointer-events: auto;
  }
  .inspection-actions {
    max-width: 100%;
    text-align: center;
  }
  .inspection-actions:empty {
    display: none;
  }
  .inspection-close {
    position: absolute;
    right: 1.25rem;
    top: 1rem;
    border: 1px solid #a2d6e64d;
    border-radius: 50%;
    width: 42px;
    height: 42px;
    color: #d8f4ff;
    background: #13222cb3;
    font-size: 1.6rem;
    cursor: pointer;
  }
  .inspection-heading {
    max-width: 90vw;
    text-align: center;
  }
  .eyebrow {
    color: #96c9d4;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.2em;
  }
  .eyebrow-dot {
    margin: 0 0.6em;
  }
  h2 {
    margin: 0.35rem 0 0;
    font-size: clamp(1.1rem, 2.5vw, 2rem);
    line-height: 1.2;
  }
  .inspection-plane {
    /* La hauteur compte aussi : titre, statut et boutons restent visibles sans défiler. */
    width: min(880px, 86vw, calc((100dvh - 19rem) * 920 / 600));
    min-width: min(320px, 90vw);
    aspect-ratio: 920 / 600;
    position: relative;
    perspective: 1500px;
    /* Chaque édition a son métal : acier pour Relief, cyan pour Vivante, or pour Mythique. */
    --edge: #a4d3e0;
    --glow: #6ddde525;
    --ink: #94d9e5;
    --star: #d9fbff;
    --star-glow: #7aeaff;
    --plaque: linear-gradient(120deg, #243f50, #07131f 52%, #24404c);
  }
  .inspection-plane[data-edition='vivante'] {
    --edge: #76e8e4;
    --glow: #4fe3dc40;
    --ink: #7ff0e8;
    --star-glow: #4fe3dc;
    --plaque: linear-gradient(120deg, #18465a, #061520 52%, #1d3f62);
  }
  .inspection-plane[data-edition='mythique'] {
    --edge: #f1d27a;
    --glow: #f4c95250;
    --ink: #f6d98a;
    --star: #fff3c4;
    --star-glow: #ffc94a;
    --plaque: linear-gradient(120deg, #4a3a17, #120d05 52%, #4b3915);
  }
  .inspection-plane.has-frame {
    margin-block: clamp(15px, 3vw, 33px) clamp(8px, 1.6vw, 19px);
    width: min(845px, 83vw, calc((100dvh - 22rem) * 920 / 600));
    min-width: min(320px, 83vw);
  }
  .inspection-plane.has-frame[data-edition='mythique'][data-frame-theme='underworld'] {
    margin-top: clamp(23px, 4vw, 45px);
  }
  .inspection-tilt,
  .inspection-flipper {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
  }
  .inspection-tilt {
    transform: translateY(var(--hover-lift, 0px)) rotateX(var(--tilt-x, 0deg))
      rotateY(var(--tilt-y, 0deg));
  }
  .inspection-plane:global([data-tilting]) .inspection-tilt {
    will-change: transform;
  }
  .inspection-flipper {
    transition: transform 550ms cubic-bezier(0.25, 0.7, 0.3, 1);
  }
  .inspection-flipper.show-back {
    transform: rotateY(180deg);
  }
  .inspection-front,
  .inspection-back {
    position: absolute;
    inset: 0;
    border-radius: 18px;
    backface-visibility: hidden;
    overflow: hidden;
    border: 1px solid var(--edge);
    box-shadow:
      0 20px 60px #000b,
      0 0 40px var(--glow);
  }
  .inspection-front {
    background: #0c1823 url('/cards/backs/relief.webp') center / 100% 100%;
  }
  [data-edition='vivante'] .inspection-front {
    background-image: url('/cards/backs/vivante.webp');
  }
  [data-edition='mythique'] .inspection-front {
    background-image: url('/cards/backs/mythique.webp');
    box-shadow:
      0 20px 60px #000b,
      0 0 55px var(--glow),
      inset 0 0 0 1px #fff1c455;
  }
  .inspection-plane .inspection-front[data-frame-theme] {
    border-color: transparent;
  }
  .inspection-plane .inspection-front[data-frame-theme='forest'] {
    background-image: radial-gradient(ellipse at 50% 10%, #354048, #101d25 69%, #0b151c);
  }
  .inspection-plane .inspection-front[data-frame-theme='underworld'] {
    background-image: radial-gradient(ellipse at 50% 42%, #361e25, #19141e 68%, #0d0a11);
  }
  .inspection-front[data-frame-theme]::before {
    display: none;
  }
  /* Mythique : un éclat doré parcourt le cadre de temps en temps, sans toucher l'illustration. */
  [data-edition='mythique'] .inspection-front::after {
    content: '';
    position: absolute;
    z-index: 1;
    inset: 0;
    padding: 2.2%;
    border-radius: inherit;
    background: linear-gradient(
      115deg,
      transparent 40%,
      #ffe7a033 46%,
      #fff6d0aa 50%,
      #ffe7a033 54%,
      transparent 60%
    );
    background-size: 300% 100%;
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: exclude;
    mix-blend-mode: screen;
    animation: mythique-glint 5s ease-in-out 1.2s infinite;
    pointer-events: none;
  }
  [data-edition='mythique'] .inspection-front[data-frame-theme]::after {
    display: none;
  }
  .inspection-front::before {
    content: '';
    position: absolute;
    z-index: 2;
    inset: 7px;
    border: 1px ridge #bddfe9b3;
    border-radius: 12px;
    box-shadow: inset 0 0 0 4px #020911a8;
    pointer-events: none;
  }
  .inspection-back {
    transform: rotateY(180deg);
  }
  .inspection-art {
    position: absolute;
    top: 2.4%;
    left: 2.2%;
    right: 2.2%;
    aspect-ratio: 920 / 430;
    overflow: hidden;
    border: 1px solid #81aabb;
    border-radius: 9px;
    background: #07101b;
    box-shadow: 0 4px 12px #0009;
  }
  .inspection-art img,
  .inspection-art canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
  .inspection-art canvas {
    opacity: 0;
    transition: opacity 300ms ease;
  }
  .inspection-art :global(canvas[data-ready]) {
    opacity: 1;
  }
  .empty-art {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 4rem;
    color: #9ad4dc;
  }
  .inspection-star {
    position: absolute;
    z-index: 3;
    left: 50%;
    top: -0.2em;
    transform: translateX(-50%);
    color: var(--star);
    font-size: clamp(18px, 3vw, 32px);
    text-shadow: 0 0 14px var(--star-glow);
  }
  .inspection-etch {
    position: absolute;
    inset: 74% 9% auto;
    height: 1px;
    background: linear-gradient(90deg, transparent, #98d6de, transparent);
  }
  .fantasy-divider,
  .divider-crystal {
    position: absolute;
    top: 74.3%;
    overflow: visible;
    pointer-events: none;
    transform: translateY(-50%);
  }
  .fantasy-divider {
    left: 13%;
    width: 74%;
    height: 3.6%;
  }
  .divider-crystal {
    left: 50%;
    height: clamp(22px, 7%, 38px);
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 1px 5px #b0edc94f);
  }
  .divider-wave {
    opacity: 0;
  }
  .underworld-divider,
  .underworld-coal {
    position: absolute;
    top: 74.3%;
    pointer-events: none;
    overflow: visible;
    transform: translateY(-50%);
  }
  .underworld-divider {
    left: 12%;
    width: 76%;
    height: 4%;
  }
  .underworld-etch,
  .underworld-heat {
    fill: none;
    stroke: #b87d57;
    stroke-width: 1.6;
    stroke-linejoin: bevel;
  }
  .underworld-etch.fine {
    stroke: #825447;
    stroke-width: 1;
  }
  .underworld-heat {
    stroke: #ffad6c;
    stroke-width: 2.7;
    stroke-dasharray: 0.28 0.72;
    opacity: 0;
    filter: drop-shadow(0 0 3px #e75228);
  }
  .underworld-coal {
    left: 50%;
    height: min(5.4%, 30px);
    transform: translate(-50%, -50%);
  }
  @media (prefers-reduced-motion: no-preference) {
    .inspection-plane:global([data-tilting]) .underworld-heat {
      animation: divider-sweep 1.4s ease-out 180ms both;
    }
    .inspection-plane:global([data-tilting]) .underworld-core {
      animation: coal-ignite 870ms ease-out both;
      transform-box: fill-box;
      transform-origin: center;
    }
  }
  @keyframes coal-ignite {
    34% {
      transform: scale(1.2);
      fill: #ffc37e;
      filter: drop-shadow(0 0 7px #ff5b31);
    }
  }
  .divider-line,
  .divider-glint {
    fill: none;
    stroke: #bc9663;
    stroke-width: 1.25;
    vector-effect: non-scaling-stroke;
  }
  @media (max-width: 640px) {
    .underworld-divider,
    .underworld-coal {
      top: 73.65%;
    }
    .underworld-divider {
      height: 3%;
    }
    [data-frame-theme='underworld'] .inspection-art {
      top: 1.7%;
    }
    [data-frame-theme='underworld'] :global(.fantasy-title) {
      bottom: 2%;
    }
    .fantasy-divider,
    .divider-crystal {
      top: 73.65%;
    }
    .fantasy-divider {
      height: 2.5%;
    }
    .divider-crystal {
      height: min(6%, 19px);
    }
    [data-frame-theme='forest'] .inspection-art {
      top: 1.7%;
    }
    [data-frame-theme='forest'] :global(.fantasy-title) {
      bottom: 2%;
    }
  }
  .divider-line {
    opacity: 0.9;
  }
  .divider-leaf {
    fill: #346b61;
    stroke: #d5b27b;
    stroke-width: 1.3;
    transform: rotate(-25deg) scale(0.22);
    opacity: 0.38;
    transition:
      transform 210ms ease-in,
      opacity 180ms ease-in;
  }
  .divider-vein {
    fill: none;
    stroke: #f3d49d;
    stroke-width: 0.9;
  }
  .inspection-plane:global([data-tilting]) .divider-leaf {
    transform: none;
    opacity: 1;
    transition:
      transform 380ms cubic-bezier(0.18, 1.4, 0.42, 1) calc(240ms + var(--leaf-step) * 70ms),
      opacity 200ms ease-out calc(240ms + var(--leaf-step) * 70ms);
  }
  .divider-glint {
    stroke: #fff0bb;
    stroke-width: 2.2;
    stroke-dasharray: 0.16 0.84;
    opacity: 0;
    filter: drop-shadow(0 0 3px #ffca78);
  }
  .inspection-plane:global([data-tilting]) .divider-glint {
    animation: divider-sweep 1.35s ease-out 180ms both;
  }
  .inspection-plane:global([data-tilting]) .divider-center {
    animation: divider-bloom 750ms cubic-bezier(0.2, 0.75, 0.4, 1) both;
    transform-box: fill-box;
    transform-origin: center;
  }
  .inspection-plane:global([data-tilting]) .divider-wave {
    animation: divider-wave 700ms ease-out 100ms both;
  }
  @keyframes divider-sweep {
    from {
      opacity: 0;
      stroke-dashoffset: 0.16;
    }
    24% {
      opacity: 1;
    }
    to {
      opacity: 0;
      stroke-dashoffset: -0.98;
    }
  }
  @keyframes divider-bloom {
    36% {
      transform: translateY(-3px) scale(1.28);
      filter: drop-shadow(0 0 7px #96f6cf);
    }
    68% {
      transform: scale(0.96);
    }
  }
  @keyframes divider-wave {
    from {
      opacity: 0.85;
      transform: scale(0.7);
    }
    to {
      opacity: 0;
      transform: scale(2.8);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .inspection-plane:global([data-tilting]) :is(.divider-glint, .divider-center, .divider-wave) {
      animation: none;
    }
  }
  @media (prefers-reduced-motion: reduce), (hover: none) {
    .fantasy-divider .divider-leaf {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }
  .inspection-etch::after {
    content: '✦';
    position: absolute;
    left: 50%;
    top: 0;
    transform: translate(-50%, -50%);
    padding: 0 10px;
    background: #0a1721;
    color: var(--ink);
  }
  .inspection-plaque {
    position: absolute;
    z-index: 3;
    inset: auto 12% 4%;
    min-height: 17%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    text-align: center;
    border: 1px solid var(--edge);
    clip-path: polygon(4% 0, 96% 0, 100% 50%, 96% 100%, 4% 100%, 0 50%);
    background: var(--plaque);
    box-shadow: inset 0 1px #dcfaff80;
  }
  .inspection-plaque strong {
    font-size: clamp(10px, 1.7vw, 23px);
    line-height: 1.2;
  }
  .inspection-plaque > span {
    font-size: clamp(7px, 1vw, 12px);
    text-transform: uppercase;
    letter-spacing: 0.25em;
    color: var(--ink);
  }
  .inspection-reflection {
    position: absolute;
    z-index: 4;
    inset: 0;
    padding: 15px;
    border-radius: inherit;
    background: radial-gradient(
      ellipse at var(--light-x, 50%) var(--light-y, 50%),
      white,
      #6ac8e5 22%,
      transparent 65%
    );
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: exclude;
    opacity: var(--shine, 0);
    mix-blend-mode: color-dodge;
    pointer-events: none;
  }
  .inspection-sheen {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(110deg, transparent 35%, #c4ecff55 47%, #fff9 50%, transparent 64%);
    background: linear-gradient(
      110deg,
      transparent 35%,
      #ffe7a044 47%,
      #fff6d0aa 50%,
      transparent 64%
    );
    animation: inspect-sheen 1.4s ease 100ms both;
  }
  /* Relief : le même reflet d'acier qu'à l'ouverture, sur toute la carte et son liseré. */
  .inspection-glint {
    position: absolute;
    z-index: 5;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(
      100deg,
      transparent 38%,
      #dceaf522 44%,
      #f5faffd0 48.5%,
      #8fa9bd70 50.5%,
      #ffffffa0 52%,
      transparent 58%
    );
    background-size: 260% 100%;
    mix-blend-mode: screen;
    pointer-events: none;
    animation: inspect-glint 0.9s cubic-bezier(0.4, 0, 0.3, 1) 120ms both;
  }
  .inspection-glint::after {
    content: '';
    position: absolute;
    inset: 0;
    padding: 2px;
    border-radius: inherit;
    background: linear-gradient(100deg, #8fb3c8, #fff 50%, #8fb3c8);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: exclude;
    animation: inspect-edge 1s ease-out 120ms both;
  }
  /* Vivante : l'illustration sort du gris et s'éveille depuis son centre. */
  [data-edition='vivante'] .inspection-art {
    animation: inspect-awaken 1.8s cubic-bezier(0.3, 0, 0.2, 1) 80ms both;
  }
  .inspection-wake {
    position: absolute;
    inset: -20%;
    background: radial-gradient(
      circle at 50% 55%,
      #e6fffbcc 0%,
      #6ff0e466 22%,
      #b37bff33 40%,
      transparent 62%
    );
    mix-blend-mode: screen;
    pointer-events: none;
    animation: inspect-wake 1.9s ease-out 120ms both;
  }
  .inspection-status {
    margin: 0;
    color: #a1d5de;
    font-size: 0.85rem;
  }
  .inspection-controls {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .inspection-nav {
    display: flex;
    gap: 1rem;
    align-items: center;
    color: #8badbb;
    font-size: 12px;
  }
  .inspection-nav button {
    border: 1px solid #789fac66;
    border-radius: 50%;
    color: #bde8f3;
    width: 36px;
    height: 36px;
    background: #11252e;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid #9aeaf5;
    outline-offset: 4px;
  }
  @keyframes mythique-glint {
    from {
      background-position: 100% 0;
    }
    45%,
    to {
      background-position: 0 0;
    }
  }
  @keyframes inspect-glint {
    from {
      background-position: 100% 0;
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    to {
      background-position: 0 0;
      opacity: 0;
    }
  }
  @keyframes inspect-edge {
    from,
    to {
      opacity: 0;
    }
    35% {
      opacity: 0.85;
    }
  }
  @keyframes inspect-awaken {
    from {
      filter: grayscale(1) brightness(0.4) contrast(1.15);
    }
    45% {
      filter: grayscale(0.6) brightness(0.75) contrast(1.05);
    }
    to {
      filter: none;
    }
  }
  @keyframes inspect-wake {
    from {
      transform: scale(0.15);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    to {
      transform: scale(1.5);
      opacity: 0;
    }
  }
  @keyframes inspect-sheen {
    from {
      transform: translateX(-110%);
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
    to {
      transform: translateX(110%);
      opacity: 0;
    }
  }
  @media (max-width: 640px) {
    .inspection-shell {
      gap: 0.85rem;
      padding-top: 4rem;
    }
    .inspection-plane {
      width: 90vw;
    }
    .inspection-front,
    .inspection-back {
      border-radius: 11px;
    }
    .inspection-front::before {
      inset: 4px;
      border-radius: 7px;
    }
    .inspection-art {
      border-radius: 5px;
    }
    .inspection-plaque {
      gap: 3px;
      padding: 5px 9px;
    }
    .inspection-etch::after {
      font-size: 10px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .inspection-flipper,
    .inspection-art canvas {
      transition: none;
    }
    .inspection-sheen,
    .inspection-glint,
    .inspection-wake,
    [data-edition='mythique'] .inspection-front::after {
      display: none;
    }
    [data-edition='vivante'] .inspection-art {
      animation: none;
    }
  }
</style>
