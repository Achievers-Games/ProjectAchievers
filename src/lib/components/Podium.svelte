<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import Avatar from './Avatar.svelte';
  import type { Collector } from '$lib/server/queries';

  let { collectors, more = true }: { collectors: Collector[]; more?: boolean } = $props();

  /** Le premier au centre, plus haut, comme sur un vrai podium. */
  const steps = $derived(
    [collectors[1], collectors[0], collectors[2]].flatMap((collector, index) =>
      collector ? [{ collector, place: [2, 1, 3][index] as number }] : [],
    ),
  );
</script>

<section class="space-y-3" aria-labelledby="podium">
  <div class="flex items-baseline justify-between gap-4">
    <h2 id="podium">{m.ranking_collectors()}</h2>
    {#if more}
      <a href="/classement" class="text-sm text-muted hover:text-ink">{m.ranking_full()}</a>
    {/if}
  </div>

  {#if collectors.length === 0}
    <p class="text-sm text-muted">{m.ranking_collectors_empty()}</p>
  {:else}
    <ol class="podium">
      {#each steps as { collector, place } (collector.handle)}
        <li class="podium-step" data-place={place} style:grid-column={[2, 1, 3][place - 1]}>
          <a href="/u/{collector.handle}" class="podium-link">
            <Avatar
              name={collector.displayName}
              src={collector.avatarUrl}
              frame={collector.frame}
              motion={collector.avatarMotionUrl}
              frameMotion={collector.frameMotionUrl}
              play="always"
              size={place === 1 ? 96 : 72}
            />
            <span class="max-w-full truncate text-sm font-semibold">{collector.displayName}</span>
            <span class="tabular text-xs text-muted">
              {m.count_cards({ count: collector.cards })}
            </span>
            <span class="tabular text-xs font-semibold">
              {m.count_points({ count: collector.score })}
            </span>
            <span class="podium-place" aria-label={m.ranking_place({ place })}>{place}</span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</section>
