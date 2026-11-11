<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Crown from '@lucide/svelte/icons/crown';
  import Empty from '#lib/components/Empty.svelte';
  import GameCard from '#lib/components/GameCard.svelte';
  import { submitWithToast } from '#lib/forms';

  let { data } = $props();

  const submit = submitWithToast({ reset: false });
</script>

<svelte:head><title>{m.showcase_edit()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <div class="space-y-1">
    <h1>{m.showcase_edit()}</h1>
    <p class="text-sm text-muted">{m.showcase_edit_help({ max: data.max })}</p>
  </div>

  <form method="POST" action="?/mode" use:enhance={submit} class="flex gap-2">
    <button name="mode" value="best" class="btn" aria-pressed={!data.custom}>
      {m.showcase_mode_best()}
    </button>
    <button name="mode" value="custom" class="btn" aria-pressed={data.custom}>
      {m.showcase_mode_custom()}
    </button>
  </form>

  {#if !data.custom}
    <p class="card px-3 py-2 text-sm text-muted">{m.showcase_mode_best_help()}</p>
    <p class="featured-hint">
      <Crown size={16} aria-hidden="true" class="shrink-0 text-gold" />
      {m.showcase_featured_help()}
    </p>
  {:else}
    <section class="space-y-3">
      <h2>{m.showcase_selected({ count: data.selected.length, max: data.max })}</h2>
      {#if data.selected.length}
        <ul class="space-y-2">
          {#each data.selected as card, index (card.id)}
            {#if index === 1}
              <!-- Le numéro 1 se détache : les suivantes forment le reste de la vitrine. -->
              <li class="border-t border-line pt-1" aria-hidden="true"></li>
            {/if}
            <li class="flex items-center gap-2" class:featured-row={index === 0}>
              <div class="min-w-0 flex-1 space-y-2">
                <GameCard
                  game={card}
                  progress={card.progress}
                  versions={card.versions}
                  tier={card.tier}
                  copies={card.copies}
                  next={card.next}
                  layout="liste"
                  featured={index === 0}
                />
                {#if index === 0}
                  <p class="featured-hint">
                    <Crown size={16} aria-hidden="true" class="shrink-0 text-gold" />
                    {m.showcase_featured_help()}
                  </p>
                {/if}
              </div>
              <form method="POST" action="?/move" use:enhance={submit} class="flex">
                {#each card.versions as version (version.slug)}
                  <input type="hidden" name="slug" value={version.slug} />
                {/each}
                <button
                  name="direction"
                  value="up"
                  class="btn btn-ghost h-8 w-8 px-0"
                  disabled={index === 0}
                  aria-label={m.showcase_up()}
                >
                  <ChevronUp size={16} aria-hidden="true" />
                </button>
                <button
                  name="direction"
                  value="down"
                  class="btn btn-ghost h-8 w-8 px-0"
                  disabled={index === data.selected.length - 1}
                  aria-label={m.showcase_down()}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              </form>
              <form method="POST" action="?/remove" use:enhance={submit}>
                {#each card.versions as version (version.slug)}
                  <input type="hidden" name="slug" value={version.slug} />
                {/each}
                <button class="btn btn-ghost h-8">{m.showcase_remove()}</button>
              </form>
            </li>
          {/each}
        </ul>
      {:else}
        <Empty title={m.showcase_none()}>{m.showcase_none_help()}</Empty>
      {/if}
    </section>

    <section class="space-y-3">
      <h2>{m.showcase_my_cards()}</h2>
      <form method="GET" class="flex gap-2">
        <input
          type="search"
          name="q"
          value={data.q}
          aria-label={m.showcase_search()}
          placeholder={m.showcase_search()}
          class="input"
        />
        <button class="btn">{m.search_short()}</button>
      </form>

      {#if data.available.length}
        <ul class="space-y-2">
          {#each data.available as card (card.id)}
            <li class="flex items-center gap-2">
              <div class="min-w-0 flex-1">
                <GameCard
                  game={card}
                  progress={card.progress}
                  versions={card.versions}
                  tier={card.tier}
                  copies={card.copies}
                  next={card.next}
                  layout="liste"
                />
              </div>
              <form method="POST" action="?/add" use:enhance={submit}>
                <input type="hidden" name="slug" value={card.slug} />
                <button class="btn h-8" disabled={data.selected.length >= data.max}>
                  {m.showcase_add()}
                </button>
              </form>
            </li>
          {/each}
        </ul>
      {:else}
        <Empty title={m.showcase_no_results()} />
      {/if}
    </section>
  {/if}

  <a href="/compte" class="btn">{m.my_account()}</a>
</div>
