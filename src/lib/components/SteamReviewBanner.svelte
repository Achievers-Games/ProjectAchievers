<script lang="ts">
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import { m } from '#lib/paraglide/messages';
  import type { SteamReviewState } from '#lib/steam-review-state';

  /**
   * Sur l'accueil, tant qu'un jeu Steam du joueur est bloqué ou attend une validation : la fenêtre
   * ne s'affiche qu'une fois, ce rappel reste jusqu'à ce que tout soit réglé.
   */
  let { reviews }: { reviews: { state: SteamReviewState }[] } = $props();
  const blocked = $derived(reviews.filter((review) => review.state === 'blocked').length);
  const pending = $derived(reviews.filter((review) => review.state === 'pending').length);
  const summary = $derived(
    [
      blocked && `${m.steam_status_blocked()} (${blocked})`,
      pending && `${m.steam_status_pending()} (${pending})`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

{#if blocked || pending}
  <aside
    class="card flex flex-wrap items-center justify-between gap-3 border-gold/50 p-4"
    data-testid="home-steam-reviews"
  >
    <div class="flex min-w-0 gap-3">
      <ShieldAlert size={22} class="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
      <div class="space-y-1 text-sm">
        <p class="font-semibold">{m.home_steam_title()}</p>
        <p class="text-muted">{summary}</p>
        <p class="text-muted">{m.home_steam_detail()}</p>
      </div>
    </div>
    <a class="btn btn-primary" href="/compte/verification-steam">{m.steam_check_open()}</a>
  </aside>
{/if}
