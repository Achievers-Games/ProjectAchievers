<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { getLocale } from '#lib/paraglide/runtime';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import CardInspection from '#lib/components/CardInspection.svelte';
  import CardBannerChoice from '#lib/components/CardBannerChoice.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import { EDITIONS } from '#lib/boosters';
  import { cardTilt } from '#lib/card-tilt';
  import { submitWithToast } from '#lib/forms';
  import type { EditionKind } from '#prisma';

  let { data, form } = $props();
  const submitBanner = submitWithToast({ reset: false });

  const editionName: Record<EditionKind, () => string> = {
    RELIEF: () => m.edition_relief(),
    VIVANTE: () => m.edition_vivante(),
    MYTHIQUE: () => m.edition_mythique(),
  };
  const RAREST_FIRST = [...EDITIONS].reverse();

  type Card = (typeof data.cards)[number];
  /**
   * Les cartes affichées : la première page chargée par le serveur, puis celles qu'« Afficher
   * plus » ajoute. Les ajouts valent pour un filtre : en changer repart de la première page.
   */
  let added = $state<{ from: string | null; cards: Card[]; next: string | null } | null>(null);
  let loading = $state(false);
  const sameView = $derived(added !== null && added.from === data.next);
  const cards = $derived(sameView ? [...data.cards, ...added!.cards] : data.cards);
  const next = $derived(sameView ? added!.next : data.next);
  const total = $derived(EDITIONS.reduce((sum, kind) => sum + data.owned[kind], 0));
  const toDiscover = $derived(EDITIONS.reduce((sum, kind) => sum + data.missing[kind], 0));

  /** L'adresse de la collection avec un autre filtre, la recherche gardée. */
  function filterUrl(kind: EditionKind | null) {
    const url = new URL(page.url.href);
    url.searchParams.delete('curseur');
    if (kind) url.searchParams.set('edition', kind.toLowerCase());
    else url.searchParams.delete('edition');
    return `${url.pathname}${url.search}`;
  }

  async function more() {
    if (!next || loading) return;
    loading = true;
    try {
      const url = new URL('/boosters/collection/cartes', page.url.origin);
      if (data.filter.kind) url.searchParams.set('edition', data.filter.kind.toLowerCase());
      if (data.filter.search) url.searchParams.set('q', data.filter.search);
      url.searchParams.set('curseur', next);
      const response = await fetch(url);
      if (!response.ok) return;
      const loaded = (await response.json()) as { cards: Card[]; next: string | null };
      added = {
        from: data.next,
        cards: [...(sameView ? added!.cards : []), ...loaded.cards],
        next: loaded.next,
      };
    } finally {
      loading = false;
    }
  }

  let inspected = $state<number | null>(null);
  const obtained = (date: Date | string) =>
    m.collection_obtained({
      date: new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long' }).format(new Date(date)),
    });
  const share = (value: number) =>
    new Intl.NumberFormat(getLocale(), {
      style: 'percent',
      maximumFractionDigits: value < 0.01 ? 2 : value < 0.1 ? 1 : 0,
    }).format(value);
  /** La date d'obtention, et la part des collectionneurs qui ont aussi la carte. */
  const status = (card: Card) =>
    card.ownerShare === null
      ? obtained(card.obtainedAt)
      : `${obtained(card.obtainedAt)} · ${m.collection_owned_by({ share: share(card.ownerShare) })}`;
  const move = (direction: number) => {
    if (inspected === null) return;
    inspected = (inspected + direction + cards.length) % cards.length;
  };
</script>

<svelte:head><title>{m.collection_title()} — Project Achievers</title></svelte:head>

{#if inspected !== null && cards[inspected]}
  <CardInspection
    card={cards[inspected]}
    position={inspected + 1}
    total={cards.length}
    status={status(cards[inspected])}
    introOnOpen
    onclose={() => (inspected = null)}
    onprevious={() => move(-1)}
    onnext={() => move(1)}
  />
{/if}

<div class="mx-auto max-w-4xl space-y-6">
  <div class="space-y-1">
    <a href="/boosters" class="text-sm text-muted">← {m.boosters_title()}</a>
    <h1>{m.collection_title()}</h1>
    <p class="text-sm text-muted">{m.collection_help()}</p>
  </div>

  {#if total || data.bannerEditionId}
    <div class="card flex flex-wrap items-center justify-between gap-3 p-4">
      <p class="text-sm text-muted">{m.collection_banner_help()}</p>
      {#if data.bannerEditionId}
        <form method="POST" action="?/banner" use:enhance={submitBanner}>
          <button class="btn" name="editionId" value="">{m.collection_banner_remove()}</button>
        </form>
      {/if}
    </div>
  {/if}
  {#if form?.error}<p class="text-sm" role="alert">{form.error}</p>{/if}

  {#if !total}
    <Empty title={m.collection_empty()}>
      {#snippet action()}<a href="/boosters" class="btn btn-primary">{m.collection_open()}</a
        >{/snippet}
    </Empty>
  {:else}
    <section class="card grid grid-cols-3 gap-3 p-4" aria-label={m.collection_progress()}>
      {#each RAREST_FIRST as kind (kind)}
        <div class="stat" data-edition={kind.toLowerCase()}>
          <span class="stat-name">{editionName[kind]()}</span>
          <span class="stat-count">{data.owned[kind]}</span>
          <span class="text-xs text-muted">
            {data.missing[kind]
              ? m.collection_to_discover({ count: data.missing[kind] })
              : m.collection_complete()}
          </span>
        </div>
      {/each}
    </section>

    <div class="flex flex-wrap items-center gap-2" role="group" aria-label={m.collection_filter()}>
      <a
        href={filterUrl(null)}
        class="btn"
        class:btn-primary={data.filter.kind === null}
        aria-current={data.filter.kind === null ? 'page' : undefined}
        data-sveltekit-noscroll>{m.collection_all({ count: total })}</a
      >
      {#each RAREST_FIRST as kind (kind)}
        {#if data.owned[kind]}
          <a
            href={filterUrl(kind)}
            class="btn"
            class:btn-primary={data.filter.kind === kind}
            aria-current={data.filter.kind === kind ? 'page' : undefined}
            data-sveltekit-noscroll>{editionName[kind]()} · {data.owned[kind]}</a
          >
        {/if}
      {/each}
      <form
        method="GET"
        class="ml-auto flex gap-2"
        data-sveltekit-noscroll
        data-sveltekit-keepfocus
      >
        {#if data.filter.kind}<input
            type="hidden"
            name="edition"
            value={data.filter.kind.toLowerCase()}
          />{/if}
        <input
          type="search"
          name="q"
          value={data.filter.search}
          aria-label={m.collection_search()}
          placeholder={m.collection_search()}
          class="input max-w-xs"
        />
      </form>
    </div>
    {#if toDiscover}
      <p class="text-sm text-muted">{m.collection_to_discover({ count: toDiscover })}</p>
    {/if}

    {#if !cards.length}
      <Empty title={m.collection_no_match()} />
    {/if}
    <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {#each cards as card, index (card.editionId)}
        <li use:cardTilt>
          <button
            type="button"
            class="tile"
            data-edition={card.kind.toLowerCase()}
            onclick={() => (inspected = index)}
            aria-label={m.booster_inspect({ name: card.game?.name ?? '—' })}
          >
            <span class="tile-surface">
              <span class="art">
                {#if card.thumbUrl}<img
                    src={card.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />{:else}<span class="empty-art" aria-hidden="true">✦</span>{/if}
                <span class="badge">{editionName[card.kind]()}</span>
              </span>
              <span class="caption">
                <span class="name">{card.game?.name ?? '—'}</span>
                <span class="date">{obtained(card.obtainedAt)}</span>
              </span>
            </span>
          </button>
          {#if data.user}
            <div class="mt-2">
              <CardBannerChoice
                {card}
                person={data.user}
                equipped={card.editionId === data.bannerEditionId}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if next}
      <div class="flex justify-center">
        <button type="button" class="btn" onclick={more} disabled={loading} aria-busy={loading}
          >{m.collection_more()}</button
        >
      </div>
    {/if}
  {/if}
</div>

<style>
  [data-edition='relief'] {
    --edition: #60a5fa;
  }
  [data-edition='vivante'] {
    --edition: #a78bfa;
  }
  [data-edition='mythique'] {
    --edition: #fbbf24;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding-left: 0.75rem;
    border-left: 3px solid var(--edition);
  }
  .stat-name {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--edition);
  }
  .stat-count {
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.2;
  }
  li {
    perspective: 900px;
  }
  .tile {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: zoom-in;
  }
  .tile-surface {
    display: block;
    overflow: hidden;
    border-radius: 0.75rem;
    border: 1px solid var(--edition);
    background: var(--color-surface, rgb(255 255 255 / 0.04));
    box-shadow: 0 0 18px color-mix(in srgb, var(--edition) 30%, transparent);
    transform: translateY(var(--hover-lift, 0px)) rotateX(var(--tilt-x, 0deg))
      rotateY(var(--tilt-y, 0deg));
    transition: box-shadow 200ms ease;
  }
  .tile:hover .tile-surface,
  .tile:focus-visible .tile-surface {
    box-shadow: 0 0 28px color-mix(in srgb, var(--edition) 55%, transparent);
  }
  .tile:focus-visible {
    outline: none;
  }
  .tile:focus-visible .tile-surface {
    outline: 2px solid var(--edition);
    outline-offset: 3px;
  }
  .art {
    position: relative;
    display: block;
    aspect-ratio: 460 / 215;
    background: color-mix(in srgb, var(--edition) 20%, black);
  }
  .art img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .empty-art {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 2rem;
    color: var(--edition);
  }
  .badge {
    position: absolute;
    left: 0.5rem;
    top: 0.5rem;
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: black;
    background: var(--edition);
  }
  .caption {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.5rem 0.75rem;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .date {
    font-size: 0.75rem;
    color: var(--color-muted, rgb(255 255 255 / 0.6));
  }
</style>
