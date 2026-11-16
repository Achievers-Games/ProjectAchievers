<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import Crown from '@lucide/svelte/icons/crown';
  import Medal from '@lucide/svelte/icons/medal';
  import Avatar from './Avatar.svelte';
  import type { Collector } from '#lib/server/queries';

  let { collectors, more = true }: { collectors: Collector[]; more?: boolean } = $props();

  /** Le premier au centre, plus haut, comme sur un vrai podium. */
  const steps = $derived(
    [collectors[1], collectors[0], collectors[2]].flatMap((collector, index) =>
      collector ? [{ collector, place: [2, 1, 3][index] as number }] : [],
    ),
  );

  /** Quelques étincelles autour du premier, placées à la main pour ne pas cacher l'avatar. */
  const SPARKS = [
    { x: 12, y: 18, delay: 0 },
    { x: 84, y: 12, delay: 0.7 },
    { x: 22, y: 52, delay: 1.4 },
    { x: 78, y: 46, delay: 2.1 },
    { x: 50, y: 4, delay: 1 },
  ];
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
            {#if place === 1}
              <span class="podium-sparks" aria-hidden="true">
                {#each SPARKS as spark, index (index)}
                  <span
                    class="podium-spark"
                    style:left="{spark.x}%"
                    style:top="{spark.y}%"
                    style:animation-delay="{spark.delay}s"
                  ></span>
                {/each}
              </span>
              <Crown size={28} class="podium-crown" aria-hidden="true" />
            {:else}
              <Medal size={20} class="podium-medal" aria-hidden="true" />
            {/if}
            <Avatar person={collector} play="always" size={place === 1 ? 96 : 72} />
            <span class="max-w-full truncate text-sm font-semibold">{collector.displayName}</span>
            <span class="tabular text-xs text-muted">
              {m.count_cards({ count: collector.cards })}
            </span>
            <span class="tabular text-xs font-semibold">
              {m.count_points({ count: collector.score })}
            </span>
            <span class="podium-block">
              <span class="podium-place" aria-label={m.ranking_place({ place })}>{place}</span>
            </span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</section>
