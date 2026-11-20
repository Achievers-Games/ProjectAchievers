<script lang="ts">
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { m } from '#lib/paraglide/messages';

  type Review = { id: string; openedAt: Date; game: { name: string; slug: string } };
  let { userId, reviews }: { userId: string; reviews: Review[] } = $props();
  let dialog = $state<HTMLDialogElement>();
  let dismissed = $state<string[]>([]);
  const storageKey = $derived(`steam-reviews:${userId}`);
  const reviewKey = (review: Review) => `${review.id}:${review.openedAt.getTime()}`;
  const pending = $derived(reviews.filter((review) => !dismissed.includes(reviewKey(review))));

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
    if (pending.length && dialog?.isConnected && !dialog.open) dialog.showModal();
    if (!pending.length && dialog?.open) dialog.close();
  });

  function acknowledge() {
    dismissed = [...new Set([...dismissed, ...pending.map(reviewKey)])].slice(-100);
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
  aria-describedby="steam-review-description"
  oncancel={(event) => {
    event.preventDefault();
    acknowledge();
  }}
  class="m-auto w-[min(28rem,calc(100vw-2rem))] max-h-[85dvh] overflow-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-2xl backdrop:bg-black/65 sm:p-6"
>
  <div class="space-y-4">
    <div class="flex items-start gap-3">
      <div class="rounded-lg border border-line bg-raised p-2.5">
        <TriangleAlert size={22} aria-hidden="true" />
      </div>
      <div class="space-y-1">
        <h2 id="steam-review-heading" class="text-lg font-semibold">
          {m.steam_review_popup_title()}
        </h2>
        <p id="steam-review-description" class="text-sm text-muted">
          {m.steam_review_popup_detail()}
        </p>
      </div>
    </div>
    <ul class="divide-y divide-line rounded-lg border border-line">
      {#each pending as review (review.id)}
        <li>
          <a
            class="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-raised"
            href="/jeux/{review.game.slug}?succes=hors-score"
            onclick={acknowledge}
          >
            <span class="text-sm font-medium">{review.game.name}</span>
            <span class="shrink-0 text-xs text-muted">{m.steam_review_unscored()}</span>
          </a>
        </li>
      {/each}
    </ul>
    <div class="flex justify-end">
      <button class="btn btn-primary" type="button" onclick={acknowledge}
        >{m.steam_review_popup_ok()}</button
      >
    </div>
  </div>
</dialog>
