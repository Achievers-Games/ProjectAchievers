<script lang="ts">
  import { onMount } from 'svelte';

  interface Person {
    displayName: string;
    avatarUrl: string | null;
    avatarMotionUrl?: string | null;
    frame?: string | null;
    frameMotionUrl?: string | null;
  }

  let {
    person = null,
    name = person?.displayName ?? '',
    src = person?.avatarUrl ?? null,
    size = 32,
    frame = person?.frame ?? null,
    motion = person?.avatarMotionUrl ?? null,
    frameMotion = person?.frameMotionUrl ?? null,
    play = 'hover',
  }: {
    /** Un profil complet ; les autres attributs servent aux aperçus. */
    person?: Person | null;
    name?: string;
    src?: string | null;
    size?: number;
    frame?: string | null;
    motion?: string | null;
    frameMotion?: string | null;
    /** Dans les listes, l'animation attend le survol : un GIF pèse près d'un mégaoctet. */
    play?: 'hover' | 'always';
  } = $props();

  let allowed = $state(false);
  let hovering = $state(false);

  onMount(() => {
    allowed = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const playing = $derived(allowed && (play === 'always' || hovering));
  const shown = $derived(motion && playing ? motion : src);
  /** Un cadre importé est une image ; ceux du site sont dessinés en CSS. */
  const overlay = $derived(frame?.startsWith('https://') ? frame : null);
  const overlayShown = $derived(frameMotion && playing ? frameMotion : overlay);
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
  class="relative inline-grid shrink-0"
  role="presentation"
  onmouseenter={() => (hovering = true)}
  onmouseleave={() => (hovering = false)}
>
  {#if frame && !overlay}
    <span class="avatar-frame" data-frame={frame}>{@render picture()}</span>
  {:else}
    {@render picture()}
  {/if}
  {#if overlayShown}
    <img src={overlayShown} alt="" class="avatar-overlay" />
  {/if}
</span>
