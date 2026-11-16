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

<svelte:head><title>{m.appearance_title()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
  <div class="space-y-1">
    <h1>{m.appearance_title()}</h1>
    <p class="text-sm text-muted">
      {data.target === 'banniere' ? m.banner_help() : m.background_help()}
    </p>
  </div>

  <nav class="flex gap-1" aria-label={m.appearance_title()}>
    {#each [{ value: 'banniere', label: m.banner_title() }, { value: 'fond', label: m.background_page() }] as tab (tab.value)}
      <a
        href="?cible={tab.value}"
        aria-current={data.target === tab.value ? 'page' : undefined}
        class="rounded px-3 py-1.5 text-sm transition-colors hover:text-ink"
        class:bg-raised={data.target === tab.value}
        class:text-muted={data.target !== tab.value}
      >
        {tab.label}
      </a>
    {/each}
  </nav>

  <form method="POST" action="?/mode" use:enhance={submit} class="flex flex-wrap gap-2">
    <input type="hidden" name="cible" value={data.target} />
    <button name="mode" value="auto" class="btn" aria-pressed={data.mode === 'auto'}>
      {m.background_auto()}
    </button>
    <button name="mode" value="off" class="btn" aria-pressed={data.mode === 'off'}>
      {data.target === 'banniere' ? m.banner_off() : m.background_off()}
    </button>
    <a href="/u/{data.handle}" class="btn btn-ghost ml-auto">{m.background_see_profile()}</a>
  </form>

  {#if data.steam}
    <section class="space-y-3">
      <h2>{m.background_steam_title()}</h2>
      {#if data.steam.url}
        <form method="POST" action="?/mode" use:enhance={submit} class="max-w-md">
          <input type="hidden" name="cible" value={data.target} />
          <button
            name="mode"
            value="steam"
            class="background-tile aspect-video"
            style:--art={art([data.steam.url])}
            aria-pressed={data.mode === 'steam'}
            aria-label={m.background_steam_use()}
          >
            {#if data.steam.motion}
              <video
                class="background-tile-video"
                src={data.steam.motion}
                poster={data.steam.url}
                autoplay
                muted
                loop
                playsinline
                aria-hidden="true"
              ></video>
            {/if}
            <span class="background-tile-name">{m.background_steam_use()}</span>
            {#if data.mode === 'steam'}
              <span class="background-tile-check" aria-hidden="true"><Check size={14} /></span>
            {/if}
          </button>
        </form>
      {:else}
        <p class="card px-3 py-2 text-sm text-muted">{m.background_steam_none()}</p>
      {/if}
    </section>
  {/if}

  <section class="space-y-3">
    <h2>{m.background_pick()}</h2>
    <form method="GET" class="flex gap-2">
      <input type="hidden" name="cible" value={data.target} />
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
              <input type="hidden" name="cible" value={data.target} />
              <button
                class="background-tile"
                style:--art={art(game.thumb ? [game.thumb, ...game.images.slice(1)] : game.images)}
                aria-pressed={current}
                aria-label={data.target === 'banniere'
                  ? m.banner_choose({ game: game.name })
                  : m.background_choose({ game: game.name })}
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
