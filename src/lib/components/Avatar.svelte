<script lang="ts">
  import { onMount } from 'svelte';

  let {
    name,
    src = null,
    size = 32,
    frame = null,
    motion = null,
    play = 'hover',
  }: {
    name: string;
    src?: string | null;
    size?: number;
    frame?: string | null;
    motion?: string | null;
    /** Dans les listes, l'animation attend le survol : un GIF pèse près d'un mégaoctet. */
    play?: 'hover' | 'always';
  } = $props();

  let allowed = $state(false);
  let hovering = $state(false);

  onMount(() => {
    allowed = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const shown = $derived(motion && allowed && (play === 'always' || hovering) ? motion : src);
</script>

{#snippet picture()}
  {#if shown}
    <img
      src={shown}
      alt=""
      style:width="{size}px"
      style:height="{size}px"
      class="shrink-0 rounded-full object-cover"
    />
  {:else}
    <span
      class="grid shrink-0 place-items-center rounded-full bg-raised text-xs font-medium text-muted"
      style:width="{size}px"
      style:height="{size}px"
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  {/if}
{/snippet}

<!-- Le survol ne fait que démarrer une animation décorative : rien à reproduire au clavier. -->
<span
  class="inline-grid shrink-0"
  role="presentation"
  onmouseenter={() => (hovering = true)}
  onmouseleave={() => (hovering = false)}
>
  {#if frame}
    <span class="avatar-frame" data-frame={frame}>{@render picture()}</span>
  {:else}
    {@render picture()}
  {/if}
</span>
