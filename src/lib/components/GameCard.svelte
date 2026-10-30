<script lang="ts">
  import type { Platform } from '@prisma/client';
  import Progress from './Progress.svelte';
  import TierBadge from './TierBadge.svelte';
  import { tilt } from '$lib/actions/tilt';
  import { PLATFORM_LABELS, plural } from '$lib/labels';
  import { tierOf, type TierProgress } from '$lib/tiers';

  interface Props {
    game: {
      name: string;
      slug: string;
      platform: Platform;
      headerUrl: string | null;
      totalAchievements: number;
    };
    progress?: TierProgress | null;
    layout?: 'grille' | 'liste';
  }

  let { game, progress = null, layout = 'grille' }: Props = $props();
  const list = $derived(layout === 'liste');
  const tier = $derived(tierOf(progress));
</script>

<a
  href="/jeux/{game.slug}"
  use:tilt
  data-tier={tier}
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
    {#if tier}
      <span class="foil" aria-hidden="true"></span>
      {#if !list}
        <span class="absolute right-2 top-2"><TierBadge {tier} /></span>
      {/if}
    {/if}
  </div>
  <div class="min-w-0 flex-1 space-y-2 p-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="truncate text-sm font-medium">{game.name}</h3>
      {#if tier && list}<TierBadge {tier} />{/if}
    </div>
    {#if progress}
      <Progress value={progress.completion} {tier} label="Progression sur {game.name}" />
      <p class="tabular text-xs text-muted">
        {progress.unlockedCount} / {game.totalAchievements} · {Math.round(progress.completion)} %
      </p>
    {:else}
      <p class="text-xs text-muted">
        {PLATFORM_LABELS[game.platform]} · {plural(game.totalAchievements, 'succès', 'succès')}
      </p>
    {/if}
  </div>
</a>
