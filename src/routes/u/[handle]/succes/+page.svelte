<script lang="ts">
  import Lock from '@lucide/svelte/icons/lock';
  import Trophy from '@lucide/svelte/icons/trophy';
  import { formatDate, formatNumber } from '$lib/labels';
  import { m } from '$lib/paraglide/messages';

  let { data } = $props();
  const { player, board } = $derived(data);

  const CATEGORY_LABELS: Record<string, () => string> = {
    start: m.ach_cat_start,
    cards: m.ach_cat_cards,
    volume: m.ach_cat_volume,
    rarity: m.ach_cat_rarity,
    time: m.ach_cat_time,
    habits: m.ach_cat_habits,
    social: m.ach_cat_social,
    season: m.ach_cat_season,
    event: m.ach_cat_event,
    secret: m.ach_cat_secret,
  };
</script>

<svelte:head>
  <title>{m.ach_page_title({ name: player.displayName })}</title>
</svelte:head>

{#snippet line(item: (typeof board.categories)[number]['items'][number])}
  <div class="flex gap-3">
    <span class="mt-0.5 shrink-0">
      {#if item.unlockedAt}
        <Trophy size={18} aria-hidden="true" />
      {:else}
        <Lock size={18} aria-hidden="true" />
      {/if}
    </span>
    <div class="min-w-0">
      <p class="font-medium">{item.title ?? m.ach_secret_title()}</p>
      <p class="text-sm text-muted">{item.text ?? m.ach_secret_text()}</p>
      {#if item.unlockedAt || item.rarity !== null}
        <p class="mt-1 text-xs text-muted">
          {#if item.unlockedAt}{formatDate(item.unlockedAt)}{/if}
          {#if item.unlockedAt && item.rarity !== null}·{/if}
          {#if item.rarity !== null}
            {m.ach_rarity({ percent: formatNumber(Math.round(item.rarity)) })}
          {/if}
        </p>
      {/if}
    </div>
  </div>
{/snippet}

<div class="space-y-8">
  <header class="space-y-2">
    <a class="text-sm text-muted hover:text-ink" href="/u/{player.handle}">{player.displayName}</a>
    <h1>{m.ach_heading()}</h1>
    <p class="text-muted">{m.ach_progress({ earned: board.earned, total: board.total })}</p>
  </header>

  {#each board.categories as { category, items } (category)}
    <section class="space-y-3" aria-labelledby="ach-{category}">
      <h2 id="ach-{category}">
        {CATEGORY_LABELS[category]?.()}
        <span class="tabular text-sm text-muted">
          {items.filter((item) => item.unlockedAt).length}/{items.length}
        </span>
      </h2>
      <ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {#each items as item (item.key)}
          <li class="card p-3" class:opacity-60={!item.unlockedAt}>
            {#if item.proof}
              <details>
                <summary class="cursor-pointer list-none">{@render line(item)}</summary>
                <div class="mt-2 border-t border-line pt-2 text-sm">
                  <p class="label">{m.ach_proof_label()}</p>
                  <ul class="mt-1 space-y-1">
                    {#each item.proof.games as game (game.slug)}
                      <li><a class="hover:text-ink" href="/jeux/{game.slug}">{game.name}</a></li>
                    {/each}
                    {#each item.proof.achievements as achievement (achievement.id)}
                      <li>
                        <a class="hover:text-ink" href="/succes/{achievement.id}">
                          {achievement.name}
                        </a>
                        <span class="text-muted">· {achievement.game.name}</span>
                      </li>
                    {/each}
                  </ul>
                </div>
              </details>
            {:else}
              {@render line(item)}
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
