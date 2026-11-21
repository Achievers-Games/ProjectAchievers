<script lang="ts">
  import type { EditionKind } from '#prisma';
  let { edition }: { edition: EditionKind } = $props();
  const name = $derived(edition.toLowerCase());
</script>

<span
  class="card-back"
  data-material={name}
  style:--metal-mask="url('/cards/backs/{name}-metal.png')"
  aria-hidden="true"
>
  <img src="/cards/backs/{name}.webp" alt="" width="920" height="430" draggable="false" />
  <span class="reflection"></span>
  <span class="foil"></span>
  <span class="glint"></span>
</span>

<style>
  .card-back {
    --strength: 0.8;
    position: absolute;
    inset: 0;
    display: block;
    overflow: hidden;
    background: #101017;
    pointer-events: none;
    isolation: isolate;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    /* Keep the complete ornamental frame when used in the taller reveal grid. */
    object-fit: fill;
  }
  .reflection,
  .foil,
  .glint {
    position: absolute;
    inset: 0;
    mask-image: var(--metal-mask);
    mask-size: 100% 100%;
    mask-repeat: no-repeat;
    opacity: calc(var(--shine, 0) * var(--strength));
    transition: opacity 350ms ease;
    mix-blend-mode: screen;
  }
  .reflection {
    background: radial-gradient(
      ellipse at var(--light-x, 50%) var(--light-y, 50%),
      #fff 0%,
      #c6f5ff 8%,
      rgb(80 177 255 / 0.55) 26%,
      transparent 65%
    );
  }
  .foil {
    background: repeating-linear-gradient(
      var(--light-angle, 110deg),
      transparent 0%,
      rgb(38 118 255 / 0.5) 12%,
      rgb(93 255 210 / 0.8) 22%,
      rgb(225 249 255 / 0.95) 25%,
      transparent 31%,
      transparent 50%
    );
    background-size: 250% 250%;
    background-position: var(--foil-x, 50%) var(--light-y, 50%);
    opacity: calc(var(--shine, 0) * 0.18);
  }
  .glint {
    background: linear-gradient(
      var(--light-angle, 110deg),
      transparent 35%,
      rgb(193 239 255 / 0.3) 45%,
      white 49.5%,
      #d3fbff 50.5%,
      rgb(123 228 255 / 0.4) 53%,
      transparent 63%
    );
    background-size: 250% 250%;
    background-position: var(--foil-x, 50%) var(--light-y, 50%);
    mix-blend-mode: color-dodge;
  }
  [data-material='vivante'] {
    --strength: 1.15;
  }
  [data-material='vivante'] .foil {
    opacity: calc(var(--shine, 0) * 0.7);
  }
  [data-material='mythique'] {
    --strength: 1.4;
  }
  [data-material='mythique'] .glint {
    filter: drop-shadow(0 0 3px #79edff);
  }
  [data-material='mythique'] .foil {
    opacity: calc(var(--shine, 0) * 0.45);
  }
  @media (prefers-reduced-motion: reduce) {
    .reflection,
    .foil,
    .glint {
      display: none;
    }
  }
</style>
