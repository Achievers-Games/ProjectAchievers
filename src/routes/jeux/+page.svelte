<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import List from '@lucide/svelte/icons/list';
  import Empty from '$lib/components/Empty.svelte';
  import GameCard from '$lib/components/GameCard.svelte';
  import type { GameListItem } from '$lib/server/queries';
  import type { Snapshot } from './$types';

  let { data } = $props();

  let timer: ReturnType<typeof setTimeout>;

  let extra = $state<GameListItem[]>([]);
  let loadedPages = $state(0);
  let loadedFor = $state<string | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let request: AbortController | undefined;

  /** Un jeu peut changer de rang entre deux pages : il ne doit pas apparaître deux fois. */
  const games = $derived([
    ...new Map([...data.games, ...extra].map((game) => [game.id, game])).values(),
  ]);
  const nextPage = $derived(data.params.page + 1 + loadedPages);
  const hasMore = $derived(nextPage <= data.pages);

  // Nouveaux filtres : la liste repart de la page rendue par le serveur.
  $effect(() => {
    const search = page.url.search;
    if (search === loadedFor) return;
    request?.abort();
    loadedFor = search;
    extra = [];
    loadedPages = 0;
    loading = false;
    failed = false;
  });

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    failed = false;
    request = new AbortController();
    const { signal } = request;
    try {
      const response = await fetch(`/api${hrefWith({ page: String(nextPage) })}`, { signal });
      if (!response.ok) throw new Error(`Réponse ${response.status}`);
      extra = [...extra, ...((await response.json()) as GameListItem[])];
      loadedPages += 1;
      loading = false;
    } catch {
      if (signal.aborted) return;
      failed = true;
      loading = false;
    }
  }

  /** Charge la suite avant d'atteindre le bas de page. */
  function whenNear(element: HTMLElement) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { rootMargin: '600px' },
    );
    observer.observe(element);
    return { destroy: () => observer.disconnect() };
  }

  /** Au retour depuis une fiche, la liste revient telle qu'elle était. */
  export const snapshot: Snapshot<{
    extra: GameListItem[];
    loadedPages: number;
    loadedFor: string | null;
  }> = {
    capture: () => ({ extra: $state.snapshot(extra), loadedPages, loadedFor }),
    restore: (saved) => {
      extra = saved.extra;
      loadedPages = saved.loadedPages;
      loadedFor = saved.loadedFor;
    },
  };

  /** Les filtres vivent dans l'URL : une vue filtrée se partage et survit au rechargement. */
  function hrefWith(changes: Record<string, string | null>) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- copie locale, jamais observée
    const next = new URLSearchParams(page.url.searchParams);
    if (!('page' in changes)) next.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const search = next.toString();
    return search ? `/jeux?${search}` : '/jeux';
  }

  const apply = (changes: Record<string, string | null>) =>
    goto(hrefWith(changes), { keepFocus: true, noScroll: true, replaceState: true });

  function onSearch(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(() => apply({ q: value || null }), 200);
  }

  const collections = [
    { value: null, label: m.games_all_mine() },
    { value: 'restants', label: m.games_unfinished() },
    { value: 'caches', label: m.games_hidden() },
  ];

  /** « Non 100 % » sert à voir ce qui est presque fini : les plus avancés passent devant. */
  const collectionHref = (filtre: string | null) =>
    hrefWith(filtre === 'restants' ? { filtre, tri: 'progression' } : { filtre, tri: null });

  const platforms = [
    { value: null, label: m.games_all_platforms() },
    { value: 'STEAM', label: 'Steam' },
    { value: 'PSN', label: 'PlayStation' },
    { value: 'XBOX', label: 'Xbox' },
  ];
</script>

<svelte:head
  ><title>{data.user ? m.games_mine() : m.games_title()} — Project Achievers</title></svelte:head
>

<div class="space-y-5">
  <div class="flex items-baseline justify-between gap-4">
    <h1>{data.user ? m.games_mine() : m.games_title()}</h1>
    <p class="tabular text-sm text-muted">{m.count_games({ count: data.total })}</p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <input
      type="search"
      value={data.params.q ?? ''}
      oninput={onSearch}
      placeholder={m.games_filter()}
      aria-label={m.games_filter_label()}
      class="input sm:w-64"
    />

    <div class="flex rounded border border-line" role="group" aria-label={m.games_platform()}>
      {#each platforms as platform (platform.label)}
        <a
          href={hrefWith({ plateforme: platform.value })}
          data-sveltekit-noscroll
          aria-current={(data.params.plateforme ?? null) === platform.value ? 'true' : undefined}
          class="px-3 py-1.5 text-sm transition-colors"
          class:bg-raised={(data.params.plateforme ?? null) === platform.value}
          class:text-muted={(data.params.plateforme ?? null) !== platform.value}
        >
          {platform.label}
        </a>
      {/each}
    </div>

    {#if data.user}
      <div class="flex rounded border border-line" role="group" aria-label={m.games_collection()}>
        {#each collections as item (item.label)}
          <a
            href={collectionHref(item.value)}
            data-sveltekit-noscroll
            aria-current={(data.params.filtre ?? null) === item.value ? 'true' : undefined}
            class="px-3 py-1.5 text-sm transition-colors"
            class:bg-raised={(data.params.filtre ?? null) === item.value}
            class:text-muted={(data.params.filtre ?? null) !== item.value}
          >
            {item.label}
          </a>
        {/each}
      </div>
    {/if}

    <div class="ml-auto flex items-center gap-2">
      <select
        class="input w-auto"
        aria-label={m.games_sort()}
        value={data.params.tri}
        onchange={(event) => apply({ tri: event.currentTarget.value })}
      >
        <option value="nom">{m.sort_name()}</option>
        <option value="succes">{m.sort_achievements()}</option>
        <option value="recent">{m.sort_recent()}</option>
        {#if data.params.mine}<option value="progression">{m.sort_progress()}</option>{/if}
      </select>
      <a
        href={hrefWith({ vue: data.params.vue === 'grille' ? 'liste' : null })}
        data-sveltekit-noscroll
        class="btn w-9 px-0"
        aria-label={data.params.vue === 'grille' ? m.view_list() : m.view_grid()}
      >
        {#if data.params.vue === 'grille'}<List size={16} />{:else}<LayoutGrid size={16} />{/if}
      </a>
    </div>
  </div>

  {#if games.length === 0}
    {#if data.user && !data.params.q && !data.params.plateforme && !data.params.filtre}
      <Empty title={m.games_empty_title()}>
        {m.games_empty_text()}
        {#snippet action()}<a href="/compte" class="btn btn-primary">{m.link_account()}</a
          >{/snippet}
      </Empty>
    {:else}
      <Empty title={m.games_none_title()}>{m.games_none_text()}</Empty>
    {/if}
  {:else}
    <div
      class={data.params.vue === 'liste'
        ? 'grid gap-2'
        : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'}
    >
      {#each games as game (game.id)}
        <GameCard
          {game}
          progress={game.progress}
          layout={data.params.vue}
          versions={game.versions}
          tier={game.tier}
          next={game.next}
        />
      {/each}
    </div>
  {/if}

  {#if hasMore}
    <!-- Un vrai lien : sans JavaScript et pour les robots, il ouvre la page suivante. -->
    {#key nextPage}
      <div class="flex justify-center" use:whenNear>
        <a
          class="btn"
          href={hrefWith({ page: String(nextPage) })}
          data-sveltekit-preload-data="off"
          onclick={(event) => {
            event.preventDefault();
            loadMore();
          }}
        >
          {#if loading}{m.loading()}{:else if failed}{m.retry()}{:else}{m.show_more()}{/if}
        </a>
      </div>
    {/key}
  {/if}
</div>
