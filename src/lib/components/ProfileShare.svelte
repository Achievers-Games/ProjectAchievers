<script lang="ts">
  import Link from '@lucide/svelte/icons/link';
  import IdCard from '@lucide/svelte/icons/id-card';
  import ImageIcon from '@lucide/svelte/icons/image';
  import FileDown from '@lucide/svelte/icons/file-down';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { m } from '#lib/paraglide/messages';
  import { toast } from '#lib/stores/toast';

  /**
   * Le partage d'un profil, en icônes : le lien du profil, et la carte de joueur, qui ouvre
   * au-dessus d'elle le choix du fichier à enregistrer (l'image, ou le PDF). Le nom de chaque action
   * apparaît au survol et au clavier, et reste lu par les lecteurs d'écran.
   */
  let { handle, origin, isPublic }: { handle: string; origin: string; isPublic: boolean } =
    $props();

  let open = $state(false);
  /** La carte se dessine sur le serveur : une à deux secondes pendant lesquelles il faut le montrer. */
  let preparing = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLElement>();

  const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  function close({ focus }: { focus: boolean }) {
    open = false;
    if (focus) trigger?.focus();
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : on donne le lien à la main.
      toast(text);
    }
  }

  /** Enregistre la carte sur l'ordinateur, en image ou en PDF, sous un nom de fichier lisible. */
  async function download(format: 'png' | 'pdf') {
    close({ focus: true });
    if (preparing) return;
    preparing = true;
    try {
      const response = await fetch(`/u/${encodeURIComponent(handle)}/carte.${format}`);
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: `achievers-${handle}.${format}`,
      });
      document.body.append(link);
      link.click();
      link.remove();
      // Le navigateur a pris le fichier : l'adresse temporaire peut partir un peu après.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast(m.action_failed(), 'error');
    } finally {
      preparing = false;
    }
  }

  function onMenuKeydown(event: KeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    // Le menu s'ouvre vers le haut : la flèche du haut s'éloigne du bouton.
    const move = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (move) {
      event.preventDefault();
      list[(at + move + list.length) % list.length]?.focus();
    } else if (event.key === 'Tab') {
      close({ focus: false });
    }
  }

  $effect(() => {
    if (open) items().at(-1)?.focus();
  });

  const cardLabel = $derived(preparing ? m.player_card_pdf_loading() : m.player_card_share());
</script>

<svelte:window
  onpointerdown={(event) => {
    if (!open) return;
    const target = event.target as Node;
    if (menu?.contains(target) || trigger?.contains(target)) return;
    close({ focus: false });
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && open) close({ focus: true });
  }}
/>

<div class="share-group" role="group" aria-label={m.share()}>
  <button
    type="button"
    class="share-icon"
    aria-label={m.share_profile()}
    data-tip={m.share_profile()}
    onclick={() => copy(`${origin}/u/${handle}`, m.share_copied())}
  >
    <Link size={16} aria-hidden="true" />
  </button>
  {#if isPublic}
    <div class="relative">
      <button
        bind:this={trigger}
        type="button"
        class="share-icon"
        aria-label={cardLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={preparing}
        data-tip={open ? undefined : cardLabel}
        data-busy={preparing ? '' : undefined}
        onclick={() => (open = !open)}
      >
        {#if preparing}
          <LoaderCircle size={16} class="motion-safe:animate-spin" aria-hidden="true" />
        {:else}
          <IdCard size={16} aria-hidden="true" />
        {/if}
      </button>
      {#if open}
        <div
          bind:this={menu}
          role="menu"
          tabindex="-1"
          aria-label={m.player_card_share()}
          class="card-menu"
          onkeydown={onMenuKeydown}
        >
          <button
            type="button"
            role="menuitem"
            class="share-icon tip-left"
            aria-label={m.player_card()}
            data-tip={m.player_card()}
            onclick={() => download('png')}
          >
            <ImageIcon size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            role="menuitem"
            class="share-icon tip-left"
            aria-label={m.player_card_pdf()}
            data-tip={m.player_card_pdf()}
            onclick={() => download('pdf')}
          >
            <FileDown size={16} aria-hidden="true" />
          </button>
        </div>
      {/if}
    </div>
  {/if}
  <!-- Annonce l'attente aux lecteurs d'écran, sans rien afficher de plus. -->
  <span class="sr-only" aria-live="polite">{preparing ? m.player_card_pdf_loading() : ''}</span>
</div>

<style>
  .share-group {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  /* Juste au-dessus du bouton : l'en-tête du profil coupe tout ce qui dépasse en bas. */
  .card-menu {
    position: absolute;
    bottom: calc(100% + 0.375rem);
    left: 50%;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    translate: -50% 0;
    border-radius: 0.5rem;
    border: 1px solid var(--color-line);
    background: var(--color-surface);
    padding: 0.25rem;
    box-shadow: 0 8px 22px rgb(0 0 0 / 0.4);
  }
  .share-icon {
    position: relative;
    display: inline-flex;
    height: 2.25rem;
    width: 2.25rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    border: 1px solid var(--color-line);
    background: rgb(var(--surface) / 0.7);
    color: var(--color-muted);
    transition:
      color 0.15s,
      background-color 0.15s;
  }
  .card-menu .share-icon {
    border-color: transparent;
    background: transparent;
  }
  .share-icon:hover,
  .share-icon:focus-visible,
  .share-icon[aria-expanded='true'] {
    color: var(--color-ink);
    background: var(--color-raised);
  }
  .share-icon[data-busy] {
    cursor: progress;
    color: var(--color-ink);
  }
  /* Le nom de l'action, au survol, au clavier et tant que le PDF se prépare : au-dessus des
     boutons de l'en-tête, à gauche de ceux du menu pour ne pas cacher son voisin. */
  .share-icon[data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 0.375rem);
    right: 0;
    z-index: 30;
    white-space: nowrap;
    border-radius: 0.375rem;
    border: 1px solid var(--color-line);
    background: var(--color-surface);
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    color: var(--color-ink);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }
  .share-icon.tip-left::after {
    bottom: auto;
    top: 50%;
    right: calc(100% + 0.5rem);
    translate: 0 -50%;
  }
  .share-icon:hover::after,
  .share-icon:focus-visible::after,
  .share-icon[data-busy]::after {
    opacity: 1;
  }
</style>
