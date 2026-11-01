<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { online } from '$lib/stores/presence';

  interface Person {
    /** Sans identifiant, pas de pastille : c'est le cas des aperçus. */
    handle?: string;
    displayName: string;
    avatarUrl: string | null;
    avatarMotionUrl?: string | null;
    frame?: string | null;
    frameMotionUrl?: string | null;
  }

  let {
    person = null,
    name,
    src,
    size = 32,
    frame,
    motion,
    frameMotion,
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

  // Recalculé : un même avatar peut changer de joueur ou d'apparence sans être recréé.
  const look = $derived({
    name: name ?? person?.displayName ?? '',
    src: src === undefined ? (person?.avatarUrl ?? null) : src,
    frame: frame === undefined ? (person?.frame ?? null) : frame,
    motion: motion === undefined ? (person?.avatarMotionUrl ?? null) : motion,
    frameMotion: frameMotion === undefined ? (person?.frameMotionUrl ?? null) : frameMotion,
  });
  const isOnline = $derived(Boolean(person?.handle && $online.has(person.handle)));
  const playing = $derived(allowed && (play === 'always' || hovering));
  const shown = $derived(look.motion && playing ? look.motion : look.src);
  /** Un cadre importé est une image ; ceux du site sont dessinés en CSS. */
  const overlay = $derived(look.frame?.startsWith('https://') ? look.frame : null);
  const overlayShown = $derived(look.frameMotion && playing ? look.frameMotion : overlay);
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
      {look.name.charAt(0).toUpperCase()}
    </span>
  {/if}
{/snippet}

<!-- Le survol ne fait que démarrer une animation décorative : rien à reproduire au clavier. -->
<span
  class="relative inline-grid h-fit w-fit shrink-0"
  role="presentation"
  onmouseenter={() => (hovering = true)}
  onmouseleave={() => (hovering = false)}
>
  {#if look.frame && !overlay}
    <span class="avatar-frame" data-frame={look.frame}>{@render picture()}</span>
  {:else}
    {@render picture()}
  {/if}
  {#if overlayShown}
    <img src={overlayShown} alt="" class="avatar-overlay" />
  {/if}
  {#if isOnline}
    <span
      class="avatar-online"
      style:--dot="{Math.max(8, Math.round(size * 0.26))}px"
      role="img"
      aria-label={m.user_online()}
      title={m.user_online()}
    ></span>
  {/if}
</span>
