<script lang="ts">
  import Clock from '@lucide/svelte/icons/clock';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import ShieldX from '@lucide/svelte/icons/shield-x';
  import { m } from '#lib/paraglide/messages';
  import type { SteamReviewState } from '#lib/steam-review-state';

  type Review = {
    id: string;
    key: string;
    state: SteamReviewState;
    game: { name: string; slug: string };
  };
  let { userId, reviews }: { userId: string; reviews: Review[] } = $props();
  let dialog = $state<HTMLDialogElement>();
  let dismissed = $state<string[]>([]);
  const storageKey = $derived(`steam-reviews:${userId}`);
  const unseen = $derived(reviews.filter((review) => !dismissed.includes(review.key)));

  /** Seules les rubriques qui concernent le compte s'affichent, la plus grave d'abord. */
  const STATES = [
    { state: 'blocked', icon: ShieldX, title: m.steam_status_blocked, tone: 'text-danger' },
    { state: 'pending', icon: Clock, title: m.steam_status_pending, tone: 'text-gold' },
    {
      state: 'unblocked',
      icon: ShieldCheck,
      title: m.steam_status_unblocked,
      tone: 'text-success',
    },
  ] as const;
  const groups = $derived(
    STATES.map((group) => ({
      ...group,
      games: unseen.filter((review) => review.state === group.state),
    })).filter((group) => group.games.length),
  );

  $effect(() => {
    let stored: unknown;
    try {
      stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    } catch {
      stored = [];
    }
    dismissed = Array.isArray(stored)
      ? stored.filter((key): key is string => typeof key === 'string')
      : [];
  });

  $effect(() => {
    if (unseen.length && dialog?.isConnected && !dialog.open) dialog.showModal();
    if (!unseen.length && dialog?.open) dialog.close();
  });

  function acknowledge() {
    dismissed = [...new Set([...dismissed, ...unseen.map((review) => review.key)])].slice(-100);
    try {
      localStorage.setItem(storageKey, JSON.stringify(dismissed));
    } catch {
      // Le navigateur peut désactiver son stockage.
    }
    dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="steam-review-heading"
  oncancel={(event) => {
    event.preventDefault();
    acknowledge();
  }}
  class="m-auto w-[min(26rem,calc(100vw-2rem))] max-h-[85dvh] overflow-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-2xl backdrop:bg-black/65"
>
  <div class="space-y-4">
    <h2 id="steam-review-heading" class="text-lg font-semibold">
      {m.steam_status_popup_title()}
    </h2>
    {#each groups as group (group.state)}
      <section class="space-y-2">
        <h3 class="flex items-center gap-2 text-sm font-semibold">
          <group.icon size={18} class={group.tone} aria-hidden="true" />
          {group.title()}
        </h3>
        <ul class="divide-y divide-line rounded-lg border border-line">
          {#each group.games as review (review.id)}
            <li>
              <a
                class="block px-3 py-2 text-sm font-medium hover:bg-raised"
                href={group.state === 'unblocked'
                  ? `/jeux/${review.game.slug}`
                  : `/jeux/${review.game.slug}?succes=hors-score`}
                onclick={acknowledge}>{review.game.name}</a
              >
            </li>
          {/each}
        </ul>
        {#if group.state === 'blocked'}
          <p class="text-xs text-muted">{m.steam_reset_hint()}</p>
        {/if}
      </section>
    {/each}
    <div class="flex justify-end">
      <button class="btn btn-primary" type="button" onclick={acknowledge}
        >{m.steam_review_popup_ok()}</button
      >
    </div>
  </div>
</dialog>
