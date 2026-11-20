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
  {:else}
    <UnderworldCardFrame {kind} {reveal} />
  {/if}
</span>

<style>
  .frame-layer {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    pointer-events: none;
  }
</style>
