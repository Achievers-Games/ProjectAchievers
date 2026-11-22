<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { m } from '#lib/paraglide/messages';
  import type { suggestions } from '#lib/server/recommendations';
  import { toast } from '#lib/stores/toast';
  import X from '@lucide/svelte/icons/x';
  import GameCard from './GameCard.svelte';
  import GameRail from './GameRail.svelte';

  type Suggestion = NonNullable<Awaited<ReturnType<typeof suggestions>>>['finish'][number];

  let { id, title, items }: { id: string; title: string; items: Suggestion[] } = $props();

  /** Retirés pendant la visite : la place reste, avec de quoi annuler un clic de trop. */
  const dismissed = new SvelteSet<string>();
  let pending = $state<string | null>(null);

  async function dismiss(item: Suggestion, value: boolean) {
    if (pending) return;
    pending = item.game.id;
    try {
      const response = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: item.game.id, dismissed: value }),
      });
      if (!response.ok) throw new Error(String(response.status));
      if (value) dismissed.add(item.game.id);
      else dismissed.delete(item.game.id);
    } catch {
      toast(m.action_failed(), 'error');
    } finally {
      pending = null;
    }
  }
</script>

<section class="home-panel" aria-labelledby={id}>
  <h2 {id}>{title}</h2>
  <GameRail {items} key={(item) => item.game.id}>
    {#snippet item(entry)}
      {#if dismissed.has(entry.game.id)}
        <div
          class="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line p-3 text-center text-sm text-muted"
        >
          <p>{m.suggestion_dismissed({ game: entry.game.name })}</p>
          <button
            type="button"
            class="btn h-8 text-xs"
            disabled={pending !== null}
            onclick={() => dismiss(entry, false)}>{m.suggestion_undo()}</button
          >
        </div>
      {:else}
        <div class="space-y-1.5">
          <GameCard game={entry.game} progress={entry.progress} tier={entry.tier} />
          <div class="flex items-start gap-1 px-1 text-xs text-muted">
            <div class="min-w-0 flex-1">
              {#if entry.reason}
                <p class="truncate" title={entry.reason.name}>
                  {entry.reason.finished
                    ? m.suggestion_because_finished({ game: entry.reason.name })
                    : m.suggestion_because_played({ game: entry.reason.name })}
                </p>
              {/if}
              {#if entry.hours}
                <p class="tabular">{m.suggestion_hours({ hours: entry.hours })}</p>
              {/if}
            </div>
            <button
              type="button"
              class="shrink-0 rounded p-1 hover:bg-raised hover:text-ink"
              aria-label={m.suggestion_dismiss({ game: entry.game.name })}
              title={m.suggestion_dismiss_short()}
              disabled={pending !== null}
              onclick={() => dismiss(entry, true)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      {/if}
    {/snippet}
  </GameRail>
</section>
