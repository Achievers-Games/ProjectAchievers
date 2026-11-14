<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import { formatRelative } from '#lib/labels';
  import type { PageData } from './$types';

  /** Les guides du jeu, ceux que les votes ont enterrés repliés en dessous. */
  let { slug, guides }: { slug: string; guides: PageData['guides'] } = $props();

  type GameGuide = PageData['guides'][number];
  let showBuried = $state(false);
  const shownGuides = $derived(guides.filter((guide) => !guide.buried));
  const buriedGuides = $derived(guides.filter((guide) => guide.buried));
</script>

{#snippet guideRow(guide: GameGuide)}
  <li>
    <a
      href="/jeux/{slug}/guides/{guide.id}"
      class="card flex items-center gap-3 p-3 transition-colors hover:bg-raised"
    >
      <span
        class="tabular w-8 shrink-0 text-center text-sm font-medium"
        class:text-danger={guide.score < 0}
        title={m.game_guide_score()}>{guide.score}</span
      >
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium">{guide.title}</span>
        <span class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {#if guide.official}
            <span class="flex items-center gap-1 font-medium text-accent">
              <BookOpen size={12} aria-hidden="true" />{m.guide_badge()}
            </span>
          {/if}
          <span>{guide.author.displayName}</span>
          <span>{formatRelative(guide.updatedAt)}</span>
          {#if guide.steps}
            <span class="tabular">
              {m.game_guide_steps({ done: guide.checked, total: guide.steps })}
            </span>
          {/if}
        </span>
      </span>
    </a>
  </li>
{/snippet}

<section class="space-y-2" data-testid="game-guides">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="flex items-center gap-2 text-base">
      <BookOpen size={16} aria-hidden="true" />
      {m.game_guides()}
    </h2>
    <a class="btn h-8" href="/jeux/{slug}/guides/ecrire">{m.game_guide_write()}</a>
  </div>
  <p class="text-xs text-muted">{m.game_guides_text()}</p>
  {#if shownGuides.length}
    <ul class="space-y-2">
      {#each shownGuides as guide (guide.id)}{@render guideRow(guide)}{/each}
    </ul>
  {:else if !buriedGuides.length}
    <p class="text-sm text-muted">{m.game_guides_empty()}</p>
  {/if}
  {#if buriedGuides.length}
    <button
      type="button"
      class="text-sm text-muted hover:text-ink"
      aria-expanded={showBuried}
      onclick={() => (showBuried = !showBuried)}
    >
      {showBuried ? m.guides_buried_hide() : m.guides_buried_show({ count: buriedGuides.length })}
    </button>
    {#if showBuried}
      <p class="text-xs text-muted">{m.guides_buried_note()}</p>
      <ul class="space-y-2">
        {#each buriedGuides as guide (guide.id)}{@render guideRow(guide)}{/each}
      </ul>
    {/if}
  {/if}
</section>
