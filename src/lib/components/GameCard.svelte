<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { Platform } from '@prisma/client';
  import CompleteBadge from './CompleteBadge.svelte';
  import Progress from './Progress.svelte';
  import { tilt } from '$lib/actions/tilt';
  import { formatPercent, PLATFORM_LABELS, tierLabel } from '$lib/labels';
  import { isComplete, stepOf, type CardProgress, type NextTier } from '$lib/collection';

  interface Props {
    game: {
      name: string;
      slug: string;
      platform: Platform;
      headerUrl: string | null;
      totalAchievements: number;
    };
    progress?: CardProgress | null;
    layout?: 'grille' | 'liste';
    versions?: { platform: Platform; slug: string; completion: number }[];
    tier?: number;
    next?: NextTier | null;
  }

  let {
    game,
    progress = null,
    layout = 'grille',
    versions = [],
    tier = 0,
    next = null,
  }: Props = $props();
  const list = $derived(layout === 'liste');
  const complete = $derived(isComplete(progress));
  const level = $derived(tier || 1);
  const step = $derived(progress ? stepOf(progress.completion) : 0);
</script>

<a
  href="/jeux/{game.slug}"
  use:tilt
  data-complete={complete || undefined}
  data-tier={complete ? level : undefined}
  data-step={step || undefined}
  data-owned={progress ? true : undefined}
  data-next={next?.tier}
  class="game-card card group flex overflow-hidden"
  class:flex-col={!list}
  class:items-center={list}
>
  <div
    class="relative shrink-0 overflow-hidden bg-raised {list
      ? 'h-14 w-28'
      : 'aspect-[460/215] w-full'}"
  >
    {#if game.headerUrl}
      <img
        src={game.headerUrl}
        alt=""
        loading="lazy"
        class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
    {/if}
    {#if step && !list}
      <span class="step-badge absolute right-2 top-2">{formatPercent(step * 25)}</span>
    {/if}
    {#if complete}
      <span class="foil" aria-hidden="true"></span>
      {#if !list}
        <span class="absolute right-2 top-2"><CompleteBadge tier={level} /></span>
      {/if}
    {/if}
  </div>
  <div class="min-w-0 flex-1 space-y-2 p-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="truncate text-sm font-medium">{game.name}</h3>
      {#if complete && list}<CompleteBadge tier={level} />{/if}
    </div>
    {#if progress}
      {#if next}
        <Progress
          value={next.completion}
          tier={next.tier}
          base={level}
          label={m.progress_toward_on({ tier: tierLabel(next.tier), game: game.name })}
        />
        <p class="tabular truncate text-xs text-muted">
          {m.next_tier({
            tier: tierLabel(next.tier),
            platform: PLATFORM_LABELS[next.platform],
            percent: Math.round(next.completion),
          })}
        </p>
      {:else}
        <Progress
          value={progress.completion}
          tier={complete ? level : 0}
          {step}
          label={m.progress_on({ game: game.name })}
        />
        <p class="tabular truncate text-xs text-muted">
          {#if versions.length > 1}
            {versions
              .map((v) => `${PLATFORM_LABELS[v.platform]} ${formatPercent(v.completion)}`)
              .join(' · ')}
          {:else}
            {progress.unlockedCount} / {game.totalAchievements} · {formatPercent(
              progress.completion,
            )}
          {/if}
        </p>
      {/if}
    {:else}
      <p class="text-xs text-muted">
        {PLATFORM_LABELS[game.platform]} · {m.count_achievements({ count: game.totalAchievements })}
      </p>
    {/if}
  </div>
</a>
