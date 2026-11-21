<script lang="ts">
  import { page } from '$app/state';
  import { m } from '#lib/paraglide/messages';
  import { getLocale } from '#lib/paraglide/runtime';
  import CardInspection from '#lib/components/CardInspection.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import { editionStill, editionThumb } from '#lib/animated-card';
  import { EDITIONS } from '#lib/boosters';
  import type { EditionKind } from '#prisma';

  let { data } = $props();
  type CardPlanRow = (typeof data.rows)[number];

  const number = (value: number) => new Intl.NumberFormat(getLocale()).format(value);
  const views: { key: typeof data.view; label: () => string }[] = [
    { key: 'a-faire', label: () => m.mod_cards_view_todo() },
    { key: 'sans-hero', label: () => m.mod_cards_view_no_hero() },
    { key: 'sans-artwork', label: () => m.mod_cards_view_no_artwork() },
    { key: 'faites', label: () => m.mod_cards_view_done() },
    { key: 'toutes', label: () => m.mod_cards_view_all() },
  ];
  const editionName: Record<EditionKind, () => string> = {
    RELIEF: () => m.edition_relief(),
    VIVANTE: () => m.edition_vivante(),
    MYTHIQUE: () => m.edition_mythique(),
  };

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

  /**
   * Ce que montre une case : la carte faite (miniature, puis la carte animée en gros plan), ou
   * l'image de départ à vérifier (le hero Steam pour Relief et Vivante, l'artwork pour la
   * Mythique), ou rien quand elle manque.
   */
  function tile(row: CardPlanRow, kind: EditionKind) {
    const assetPath = row.editions?.[kind] ?? null;
    if (assetPath)
      return { status: 'done' as const, image: editionThumb(assetPath, row.heroUrl), assetPath };
    const image = kind === 'MYTHIQUE' ? row.mythiqueArtUrl : row.heroUrl;
    return { status: image ? ('ready' as const) : ('missing' as const), image, assetPath: null };
  }

  /** La carte animée inspectée : les trois éditions du jeu, en commençant par celle cliquée. */
  let inspected = $state<{ row: CardPlanRow; index: number } | null>(null);
  const inspectedCards = $derived(
    inspected?.row.editions
      ? EDITIONS.map((kind) => {
          const assetPath = inspected!.row.editions![kind];
          return {
            kind,
            assetPath,
            game: {
              name: inspected!.row.name,
              headerUrl: editionStill(assetPath, inspected!.row.heroUrl),
            },
          };
        })
      : [],
  );

  /** L'image de départ agrandie, pour juger son cadrage et sa qualité. */
  let zoomed = $state<{ src: string; label: string } | null>(null);
  let zoomDialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (zoomed && zoomDialog && !zoomDialog.open) zoomDialog.showModal();
  });

  function open(row: CardPlanRow, kind: EditionKind) {
    const shown = tile(row, kind);
    if (shown.status === 'done') inspected = { row, index: EDITIONS.indexOf(kind) };
    else if (shown.image)
      zoomed = { src: shown.image, label: `${row.name} — ${editionName[kind]()}` };
  }
</script>

<svelte:head>
  <title>{m.mod_cards()} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if inspected && inspectedCards.length}
  {@const total = inspectedCards.length}
  <CardInspection
    card={inspectedCards[inspected.index]!}
    position={inspected.index + 1}
    {total}
    introOnOpen
    onclose={() => (inspected = null)}
    onprevious={() => inspected && (inspected.index = (inspected.index + total - 1) % total)}
    onnext={() => inspected && (inspected.index = (inspected.index + 1) % total)}
  />
{/if}

{#if zoomed}
  <dialog
    bind:this={zoomDialog}
    class="zoom"
    aria-label={zoomed.label}
    onclose={() => (zoomed = null)}
    onclick={() => zoomDialog?.close()}
  >
    <img src={zoomed.src} alt={zoomed.label} />
    <p>{zoomed.label}</p>
  </dialog>
{/if}

<div class="mx-auto max-w-5xl space-y-4">
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

  <ul class="space-y-3">
    {#each data.rows as row (row.familyKey)}
      <li class="card space-y-2 p-3" data-testid="card-plan">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <a href="/jeux/{row.slug}" class="truncate font-semibold">{row.name}</a>
          <span class="text-xs text-muted">
            {m.mod_cards_players({ count: number(row.players) })}
            {#if row.steamAppId}
              · <a
                href="https://store.steampowered.com/app/{row.steamAppId}"
                target="_blank"
                rel="noreferrer">Steam {row.steamAppId}</a
              >
            {/if}
          </span>
          {#if row.note}<span class="text-xs text-muted">· {row.note}</span>{/if}
        </div>
        <div class="grid grid-cols-3 gap-2">
          {#each EDITIONS as kind (kind)}
            {@const shown = tile(row, kind)}
            <button
              type="button"
              class="tile"
              data-edition={kind.toLowerCase()}
              data-status={shown.status}
              disabled={shown.status === 'missing'}
              onclick={() => open(row, kind)}
              aria-label={`${m.mod_cards_zoom()} ${row.name} — ${editionName[kind]()}`}
            >
              {#if shown.image}
                <img src={shown.image} alt="" loading="lazy" />
              {/if}
              <span class="label">
                <span class="kind">{editionName[kind]()}</span>
                <span class="state">
                  {shown.status === 'done'
                    ? m.mod_cards_card_done()
                    : shown.status === 'ready'
                      ? kind === 'MYTHIQUE'
                        ? m.mod_cards_artwork_ready()
                        : m.mod_cards_hero_ready()
                      : kind === 'MYTHIQUE'
                        ? m.mod_cards_artwork_missing()
                        : m.mod_cards_hero_missing()}
                </span>
              </span>
            </button>
          {/each}
        </div>
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
  [data-edition='relief'] {
    --edition: #60a5fa;
  }
  [data-edition='vivante'] {
    --edition: #a78bfa;
  }
  [data-edition='mythique'] {
    --edition: #fbbf24;
  }
  .tile {
    position: relative;
    display: block;
    aspect-ratio: 460 / 215;
    overflow: hidden;
    border-radius: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--edition) 45%, transparent);
    background: color-mix(in srgb, var(--edition) 8%, transparent);
    padding: 0;
    cursor: zoom-in;
  }
  .tile[data-status='done'] {
    border-color: var(--edition);
    box-shadow: 0 0 14px color-mix(in srgb, var(--edition) 35%, transparent);
  }
  .tile[data-status='ready'] img {
    /* Pas encore une carte : l'image de départ, un peu éteinte. */
    filter: saturate(0.7) brightness(0.8);
  }
  .tile[data-status='missing'] {
    border-style: dashed;
    cursor: default;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .tile:not(:disabled):hover {
    outline: 2px solid var(--edition);
  }
  .label {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.2rem 0.45rem;
    font-size: 0.7rem;
    line-height: 1.3;
    color: white;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.8));
    text-align: left;
  }
  .kind {
    font-weight: 600;
    color: var(--edition);
  }
  .tile[data-status='done'] .state {
    color: #86efac;
  }
  .tile[data-status='missing'] .state {
    color: #fca5a5;
  }
  .zoom {
    margin: auto;
    max-width: min(96vw, 1600px);
    padding: 0;
    border: 0;
    background: transparent;
    cursor: zoom-out;
  }
  .zoom::backdrop {
    background: rgb(0 0 0 / 0.85);
  }
  .zoom img {
    display: block;
    max-width: 100%;
    max-height: 88vh;
    margin: auto;
  }
  .zoom p {
    margin: 0.5rem 0 0;
    text-align: center;
    color: white;
  }
</style>
