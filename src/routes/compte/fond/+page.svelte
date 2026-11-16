<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Check from '@lucide/svelte/icons/check';
  import Empty from '#lib/components/Empty.svelte';
  import { submitWithToast } from '#lib/forms';

  let { data } = $props();

  const submit = submitWithToast({ reset: false });

  const art = (images: string[]) => images.map((image) => `url("${encodeURI(image)}")`).join(', ');
</script>

<svelte:head><title>{m.background_title()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
  <div class="space-y-1">
    <h1>{m.background_title()}</h1>
    <p class="text-sm text-muted">{m.background_help()}</p>
  </div>

  <form method="POST" action="?/mode" use:enhance={submit} class="flex flex-wrap gap-2">
    <button name="mode" value="auto" class="btn" aria-pressed={data.mode === 'auto'}>
      {m.background_auto()}
    </button>
    <button name="mode" value="off" class="btn" aria-pressed={data.mode === 'off'}>
      {m.background_off()}
    </button>
    <a href="/u/{data.handle}" class="btn btn-ghost ml-auto">{m.background_see_profile()}</a>
  </form>

  <section class="space-y-3">
    <h2>{m.background_pick()}</h2>
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

    {#if data.games.length}
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each data.games as game (game.id)}
          {@const current = data.mode === 'game' && data.chosen === game.id}
          <li>
            <form method="POST" action="?/choose" use:enhance={submit}>
              <input type="hidden" name="game" value={game.id} />
              <button
                class="background-tile"
                style:--art={art(game.images)}
                aria-pressed={current}
                aria-label={m.background_choose({ game: game.name })}
              >
                <span class="background-tile-name">{game.name}</span>
                {#if current}
                  <span class="background-tile-check" aria-hidden="true"><Check size={14} /></span>
                {/if}
              </button>
            </form>
          </li>
        {/each}
      </ul>
    {:else}
      <Empty title={m.showcase_no_results()} />
    {/if}
  </section>

  <a href="/compte" class="btn">{m.my_account()}</a>
</div>
