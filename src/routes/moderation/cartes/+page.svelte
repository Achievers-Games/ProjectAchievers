<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { m } from '#lib/paraglide/messages';
  import { getLocale } from '#lib/paraglide/runtime';
  import Empty from '#lib/components/Empty.svelte';

  let { data, form } = $props();

  const number = (value: number) => new Intl.NumberFormat(getLocale()).format(value);
  const views: { key: typeof data.view; label: () => string }[] = [
    { key: 'a-faire', label: () => m.mod_cards_view_todo() },
    { key: 'sans-hero', label: () => m.mod_cards_view_no_hero() },
    { key: 'sans-artwork', label: () => m.mod_cards_view_no_artwork() },
    { key: 'faites', label: () => m.mod_cards_view_done() },
    { key: 'toutes', label: () => m.mod_cards_view_all() },
  ];

  /** L'adresse de la liste avec d'autres réglages, la recherche en cours gardée. */
  function listUrl(change: { vue?: typeof data.view; page?: number }) {
    const url = new URL(page.url.href);
    if (change.vue) {
      url.searchParams.set('vue', change.vue);
      url.searchParams.delete('page');
    }
    if (change.page) url.searchParams.set('page', String(change.page));
    return `${url.pathname}${url.search}`;
  }
</script>

<svelte:head>
  <title>{m.mod_cards()} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-4xl space-y-4">
  <a href="/moderation" class="text-sm text-muted">← {m.moderation()}</a>
  <h1>{m.mod_cards()}</h1>
  <p class="text-sm text-muted">{m.mod_cards_text()}</p>

  <section class="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={m.mod_cards()}>
    <div class="card stat p-3">
      <span class="text-xs text-muted">{m.mod_cards_games()}</span>
      <strong>{number(data.totals.games)}</strong>
      <span class="text-xs text-muted">{m.mod_cards_made({ count: number(data.totals.made) })}</span
      >
    </div>
    <div class="card stat p-3">
      <span class="text-xs text-muted">{m.mod_cards_left()}</span>
      <strong>{number(data.totals.cardsLeft)}</strong>
    </div>
    <div class="card stat p-3">
      <span class="text-xs text-muted">{m.mod_cards_relief_vivante()}</span>
      <strong>{number(data.totals.heroes)}</strong>
      <span class="text-xs text-muted">
        {m.mod_cards_heroes_missing({ count: number(data.totals.heroesMissing) })}
      </span>
    </div>
    <div class="card stat p-3">
      <span class="text-xs text-muted">{m.mod_cards_mythique()}</span>
      <strong>{number(data.totals.artworks)}</strong>
      <span class="text-xs text-muted">
        {m.mod_cards_artworks_missing({ count: number(data.totals.artworksMissing) })}
      </span>
    </div>
  </section>

  <div class="flex flex-wrap items-center gap-2">
    <nav class="flex flex-wrap gap-1" aria-label={m.mod_cards()}>
      {#each views as view (view.key)}
        <a
          href={listUrl({ vue: view.key })}
          class="btn {data.view === view.key ? '' : 'btn-ghost'}"
          aria-current={data.view === view.key ? 'page' : undefined}
          data-sveltekit-noscroll>{view.label()}</a
        >
      {/each}
    </nav>
    <form method="GET" class="ml-auto flex gap-2" data-sveltekit-noscroll data-sveltekit-keepfocus>
      <input type="hidden" name="vue" value={data.view} />
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
  {#if form?.error}<p class="text-sm text-danger" role="alert">{form.error}</p>{/if}

  <ul class="space-y-3">
    {#each data.rows as row (row.familyKey)}
      <li class="card flex flex-wrap items-start gap-3 p-3" data-testid="card-plan">
        {#if row.heroUrl}
          <a href={row.heroUrl} target="_blank" rel="noreferrer" class="shrink-0">
            <img src={row.heroUrl} alt="" loading="lazy" class="h-12 w-36 rounded object-cover" />
          </a>
        {:else}
          <span class="h-12 w-36 shrink-0 rounded bg-line"></span>
        {/if}
        <div class="min-w-0 flex-1 space-y-1">
          <a href="/jeux/{row.slug}" class="block truncate font-semibold">{row.name}</a>
          <p class="text-xs text-muted">
            {m.mod_cards_players({ count: number(row.players) })}
            {#if row.steamAppId}
              · <a
                href="https://store.steampowered.com/app/{row.steamAppId}"
                target="_blank"
                rel="noreferrer">Steam {row.steamAppId}</a
              >
            {/if}
          </p>
          <div class="flex flex-wrap gap-1 text-xs">
            {#if row.made}
              <span class="chip done">{m.mod_cards_done()}</span>
            {:else}
              <span class="chip {row.heroUrl ? 'ready' : 'missing'}">
                {m.mod_cards_relief_vivante()} · {row.heroUrl
                  ? m.mod_cards_hero_ready()
                  : m.mod_cards_hero_missing()}
              </span>
              <span class="chip {row.mythiqueArtUrl ? 'ready' : 'missing'}">
                {m.mod_cards_mythique()} · {row.mythiqueArtUrl
                  ? m.mod_cards_artwork_ready()
                  : m.mod_cards_artwork_missing()}
              </span>
            {/if}
          </div>
        </div>
        <form
          method="POST"
          action="?/plan"
          use:enhance={() =>
            async ({ update }) =>
              update({ reset: false })}
          class="flex w-full flex-wrap items-end gap-2 sm:w-auto"
        >
          <input type="hidden" name="familyKey" value={row.familyKey} />
          <label class="flex flex-col text-xs">
            {m.mod_cards_artwork()}
            <input
              type="url"
              name="mythiqueArtUrl"
              value={row.mythiqueArtUrl ?? ''}
              placeholder="https://"
              class="input h-8 w-56"
            />
          </label>
          <label class="flex flex-col text-xs">
            {m.mod_cards_note()}
            <input
              type="text"
              name="note"
              value={row.note ?? ''}
              maxlength="500"
              class="input h-8 w-40"
            />
          </label>
          <button class="btn h-8">{m.mod_cards_save()}</button>
          {#if form?.saved === row.familyKey}<span class="text-xs text-muted"
              >{m.mod_cards_saved()}</span
            >{/if}
          {#if row.mythiqueArtUrl}
            <a href={row.mythiqueArtUrl} target="_blank" rel="noreferrer" class="text-xs">
              {m.mod_cards_artwork_open()}
            </a>
          {/if}
        </form>
      </li>
    {:else}
      <Empty title={m.mod_cards_empty()} />
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

<style>
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .stat strong {
    font-size: 1.5rem;
  }
  .chip {
    white-space: nowrap;
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    border: 1px solid var(--color-line, #334155);
  }
  .chip.done {
    color: #86efac;
    border-color: #16a34a80;
  }
  .chip.ready {
    color: #93c5fd;
    border-color: #2563eb80;
  }
  .chip.missing {
    color: #fca5a5;
    border-color: #dc262680;
  }
</style>
