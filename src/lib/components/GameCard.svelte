<script lang="ts">
  import type { Platform } from '@prisma/client';
  import Progress from './Progress.svelte';
  import { PLATFORM_LABELS, plural } from '$lib/labels';

  interface Props {
    game: {
      name: string;
      slug: string;
      platform: Platform;
      headerUrl: string | null;
      totalAchievements: number;
    };
    progress?: { unlockedCount: number; completion: number; platinum: boolean } | null;
    layout?: 'grille' | 'liste';
  }

  let { game, progress = null, layout = 'grille' }: Props = $props();
  const list = $derived(layout === 'liste');
</script>

<a
  href="/jeux/{game.slug}"
  class="card group flex overflow-hidden transition-colors hover:border-muted/60"
  class:flex-col={!list}
  class:items-center={list}
>
  <div class="shrink-0 overflow-hidden bg-raised {list ? 'h-14 w-28' : 'aspect-[460/215] w-full'}">
    {#if game.headerUrl}
      <img src={game.headerUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
    {/if}
  </div>
  <div class="min-w-0 flex-1 space-y-2 p-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="truncate text-sm font-medium">{game.name}</h3>
      {#if progress?.platinum}
        <span class="shrink-0 text-xs font-medium text-platinum">Terminé</span>
      {/if}
    </div>
    {#if progress}
      <Progress value={progress.completion} label="Progression sur {game.name}" />
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
