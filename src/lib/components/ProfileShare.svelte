<script lang="ts">
  import Link from '@lucide/svelte/icons/link';
  import IdCard from '@lucide/svelte/icons/id-card';
  import Download from '@lucide/svelte/icons/download';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { m } from '#lib/paraglide/messages';
  import { toast } from '#lib/stores/toast';

  /**
   * Le partage d'un profil en trois icônes : le lien du profil, le lien de la carte, la carte en
   * PDF. Le nom de chaque action apparaît au survol et au clavier, et reste lu par les lecteurs
   * d'écran.
   */
  let { handle, origin, isPublic }: { handle: string; origin: string; isPublic: boolean } =
    $props();

  /** Le PDF se dessine sur le serveur : une à deux secondes pendant lesquelles il faut le montrer. */
  let preparing = $state(false);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : on donne le lien à la main.
      toast(text);
    }
  }

  async function downloadPdf() {
    if (preparing) return;
    preparing = true;
    try {
      const response = await fetch(`/u/${encodeURIComponent(handle)}/carte.pdf`);
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: `achievers-${handle}.pdf`,
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

  const pdfLabel = $derived(preparing ? m.player_card_pdf_loading() : m.player_card_pdf());
</script>

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
    <button
      type="button"
      class="share-icon"
      aria-label={m.player_card()}
      data-tip={m.player_card()}
      onclick={() => copy(`${origin}/u/${handle}/carte.png`, m.player_card_copied())}
    >
      <IdCard size={16} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="share-icon"
      aria-label={pdfLabel}
      aria-busy={preparing}
      data-tip={pdfLabel}
      data-busy={preparing ? '' : undefined}
      onclick={downloadPdf}
    >
      {#if preparing}
        <LoaderCircle size={16} class="motion-safe:animate-spin" aria-hidden="true" />
      {:else}
        <Download size={16} aria-hidden="true" />
      {/if}
    </button>
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
  .share-icon:hover,
  .share-icon:focus-visible {
    color: var(--color-ink);
    background: var(--color-raised);
  }
  .share-icon[data-busy] {
    cursor: progress;
    color: var(--color-ink);
  }
  /* Le nom de l'action, au-dessus de l'icône (l'en-tête coupe ce qui dépasse en bas) : au survol, au clavier, et tant que le PDF se prépare. */
  .share-icon::after {
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
  .share-icon:hover::after,
  .share-icon:focus-visible::after,
  .share-icon[data-busy]::after {
    opacity: 1;
  }
</style>
