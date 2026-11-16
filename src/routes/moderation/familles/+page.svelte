<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { m } from '#lib/paraglide/messages';
  import Empty from '#lib/components/Empty.svelte';
  import { PLATFORM_LABELS } from '#lib/labels';
  import GamePicker from './GamePicker.svelte';

  let { data, form } = $props();

  /** L'adresse de la liste avec d'autres réglages, la recherche en cours gardée. */
  function listUrl(change: { vue?: string | null; page?: number }) {
    const url = new URL(page.url.href);
    if ('vue' in change) {
      if (change.vue) url.searchParams.set('vue', change.vue);
      else url.searchParams.delete('vue');
      url.searchParams.delete('page');
    }
    if (change.page) url.searchParams.set('page', String(change.page));
    return `${url.pathname}${url.search}`;
  }
</script>

<svelte:head>
  <title>{m.mod_groups()} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
  <a href="/moderation" class="text-sm text-muted">← {m.moderation()}</a>
  <h1>{m.mod_groups()}</h1>
  <p class="text-sm text-muted">{m.mod_groups_text()}</p>

  <form method="POST" action="?/join" use:enhance class="card space-y-2 p-3">
    <h2 class="text-base">{m.mod_families_join_title()}</h2>
    <div class="flex flex-wrap gap-2">
      <GamePicker name="first" label={m.mod_first()} placeholder={m.mod_first_placeholder()} />
      <GamePicker name="second" label={m.mod_second()} placeholder={m.mod_second_placeholder()} />
      <button class="btn">{m.mod_join()}</button>
    </div>
    {#if form?.error}<p class="text-sm text-danger" role="alert">{form.error}</p>{/if}
  </form>

  <div class="flex flex-wrap items-center gap-2">
    <nav class="flex gap-1" aria-label={m.mod_groups()}>
      <a
        href={listUrl({ vue: null })}
        class="btn {data.validated ? 'btn-ghost' : ''}"
        aria-current={data.validated ? undefined : 'page'}
        data-sveltekit-noscroll
      >
        {m.mod_families_pending({ count: data.counts.pending })}
      </a>
      <a
        href={listUrl({ vue: 'validees' })}
        class="btn {data.validated ? '' : 'btn-ghost'}"
        aria-current={data.validated ? 'page' : undefined}
        data-sveltekit-noscroll
      >
        {m.mod_families_done({ count: data.counts.done })}
      </a>
    </nav>
    <form method="GET" class="ml-auto flex gap-2" data-sveltekit-noscroll data-sveltekit-keepfocus>
      {#if data.validated}<input type="hidden" name="vue" value="validees" />{/if}
      <input
        type="search"
        name="q"
        value={data.search}
        aria-label={m.mod_families_search()}
        placeholder={m.mod_families_search()}
        class="input max-w-xs"
      />
    </form>
  </div>

  <ul class="space-y-3">
    {#each data.families as family (family.key)}
      {@const ids = family.games.map((game) => game.id)}
      <li class="card space-y-2 p-3" data-testid="family">
        <div class="flex items-center gap-2 text-sm">
          <span class="rounded bg-line px-2 py-0.5 text-xs">
            {family.reason === 'list'
              ? m.mod_families_reason_list()
              : m.mod_families_reason_title()}
          </span>
          {#if !data.validated}
            <form method="POST" action="?/confirm" use:enhance class="ml-auto">
              <input type="hidden" name="family" value={family.key} />
              <button class="btn h-8">{m.mod_families_confirm()}</button>
            </form>
          {/if}
        </div>

        {#each family.games as game (game.id)}
          <div class="flex items-center gap-3 text-sm">
            {#if game.coverUrl}
              <img
                src={game.coverUrl}
                alt=""
                loading="lazy"
                class="h-9 w-16 shrink-0 rounded object-cover"
              />
            {:else}
              <span class="h-9 w-16 shrink-0 rounded bg-line"></span>
            {/if}
            <div class="min-w-0 flex-1">
              <a href="/jeux/{game.slug}" class="block truncate">{game.name}</a>
              <span class="text-xs text-muted">
                {PLATFORM_LABELS[game.platform]} · {m.mod_families_achievements({
                  count: game.totalAchievements,
                })}
              </span>
            </div>
            <form method="POST" action="?/separate" use:enhance>
              <input type="hidden" name="id" value={game.id} />
              <button class="btn btn-ghost h-8">{m.mod_separate()}</button>
            </form>
          </div>
        {/each}

        <form method="POST" action="?/join" use:enhance class="flex gap-2 pt-1">
          <input type="hidden" name="first" value={family.games[0]?.id} />
          <GamePicker
            name="second"
            label={m.mod_families_add()}
            placeholder={m.mod_families_add_placeholder()}
            exclude={ids}
          />
          <button class="btn btn-ghost">{m.mod_families_add()}</button>
        </form>
      </li>
    {:else}
      <Empty title={m.mod_families_empty()} />
    {/each}
  </ul>

  {#if data.pages > 1}
    <nav class="flex items-center justify-between text-sm" aria-label={m.mod_families_pages()}>
      {#if data.page > 1}
        <a href={listUrl({ page: data.page - 1 })} class="btn btn-ghost">
          ← {m.mod_families_previous()}
        </a>
      {:else}
        <span></span>
      {/if}
      <span class="text-muted">
        {m.mod_families_page({ page: data.page, pages: data.pages })}
      </span>
      {#if data.page < data.pages}
        <a href={listUrl({ page: data.page + 1 })} class="btn btn-ghost">
          {m.mod_families_next()} →
        </a>
      {:else}
        <span></span>
      {/if}
    </nav>
  {/if}
</div>
