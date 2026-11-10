<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import Seo from '#lib/components/Seo.svelte';
  import { goto, snapshot } from '$app/navigation';
  import { page } from '$app/state';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import List from '@lucide/svelte/icons/list';
  import Empty from '#lib/components/Empty.svelte';
  import GameCard from '#lib/components/GameCard.svelte';
  import TierLegend from '#lib/components/TierLegend.svelte';
  import { PLATFORM_LABELS, tierLabel, tierRule } from '#lib/labels';
  import { TIERS, TIER_SLUGS } from '#lib/collection';
  import type { GameListItem } from '#lib/server/queries';

  let { data } = $props();

  let timer: ReturnType<typeof setTimeout>;

  const heading = $derived.by(() => {
    if (data.player) return m.games_of({ name: data.player.displayName });
    return data.user ? m.games_mine() : m.games_title();
  });

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
  snapshot<{
    extra: GameListItem[];
    loadedPages: number;
    loadedFor: string | null;
  }>({
    capture: () => ({ extra: $state.snapshot(extra), loadedPages, loadedFor }),
    restore: (saved) => {
      extra = saved.extra;
      loadedPages = saved.loadedPages;
      loadedFor = saved.loadedFor;
    },
  });

  /** Les filtres vivent dans l'URL : une vue filtrée se partage et survit au rechargement. */
  function hrefWith(changes: Record<string, string | null>) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- copie locale, jamais observée
    const next = new URLSearchParams([...page.url.searchParams]);
    if (!('page' in changes)) next.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const search = next.toString();
    return search ? `/jeux?${search}` : '/jeux';
  }

  const apply = (changes: Record<string, string | null>) =>
    goto(hrefWith(changes), { replace: true, reset: false });

  function onSearch(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(() => apply({ q: value || null }), 200);
  }

  const collections = [
    { value: null, label: m.games_all_mine() },
    { value: 'termines', label: m.games_finished() },
    { value: 'restants', label: m.games_unfinished() },
    { value: 'saison', label: m.nav_season() },
    { value: 'caches', label: m.games_hidden() },
  ];

  const tiers = TIERS.map((tier) => ({
    value: TIER_SLUGS[tier - 1],
    label: tierLabel(tier),
    tier,
  }));

  /** Chaque groupe de filtres est indépendant : changer l'un garde les autres. */
  const filtered = $derived(
    ['q', 'plateforme', 'filtre', 'niveau', 'tri'].some((key) => page.url.searchParams.has(key)),
  );
  const clearHref = $derived.by(() => {
    const vue = page.url.searchParams.get('vue');
    const joueur = page.url.searchParams.get('joueur');
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- copie locale, jamais observée
    const next = new URLSearchParams();
    if (joueur) next.set('joueur', joueur);
    if (vue) next.set('vue', vue);
    const search = next.toString();
    return search ? `/jeux?${search}` : '/jeux';
  });

  const CONSOLE_PLATFORMS: Record<string, string> = {
    PS3: 'PSN',
    PS4: 'PSN',
    PS5: 'PSN',
    VITA: 'PSN',
    X360: 'XBOX',
    XONE: 'XBOX',
  };

  /** La plateforme filtrée n'a rien à montrer parce que le joueur ne l'a pas liée. */
  const toLink = $derived(
    !data.player && !data.params.q
      ? data.unlinked.find(
          (platform) =>
            platform ===
            (CONSOLE_PLATFORMS[data.params.plateforme ?? ''] ?? data.params.plateforme),
        )
      : undefined,
  );

  /** Les consoles se filtrent séparément : un joueur cherche « PS3 », pas « PlayStation ». */
  const platforms = [
    { value: null, label: m.games_all_platforms() },
    { value: 'STEAM', label: PLATFORM_LABELS.STEAM },
    { value: 'PS5', label: 'PS5' },
    { value: 'PS4', label: 'PS4' },
    { value: 'PS3', label: 'PS3' },
    { value: 'VITA', label: 'Vita' },
    { value: 'XONE', label: 'Xbox One/Series' },
    { value: 'X360', label: 'Xbox 360' },
    { value: 'RETRO', label: PLATFORM_LABELS.RETRO },
    { value: 'BLIZZARD', label: PLATFORM_LABELS.BLIZZARD },
  ];
</script>

<Seo title="{heading} — Project Achievers" description={m.site_description()} />

<div class="space-y-5">
  <div class="flex items-baseline justify-between gap-4">
    <h1>{heading}</h1>
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

    <div
      class="flex flex-wrap rounded border border-line"
      role="group"
      aria-label={m.games_platform()}
    >
      {#each platforms as platform (platform.label)}
        <a
          href={hrefWith({ plateforme: platform.value })}
          data-sveltekit-reset="false"
          aria-current={(data.params.plateforme ?? null) === platform.value ? 'true' : undefined}
          class="px-3 py-1.5 text-sm transition-colors"
          class:bg-raised={(data.params.plateforme ?? null) === platform.value}
          class:text-muted={(data.params.plateforme ?? null) !== platform.value}
        >
          {platform.label}
        </a>
      {/each}
    </div>

    {#if data.params.mine}
      <div
        class="flex flex-wrap rounded border border-line"
        role="group"
        aria-label={m.games_collection()}
      >
        {#each collections.filter((item) => !data.player || (item.value !== 'caches' && item.value !== 'saison')) as item (item.label)}
          <a
            href={hrefWith({ filtre: item.value })}
            data-sveltekit-reset="false"
            aria-current={(data.params.filtre ?? null) === item.value ? 'true' : undefined}
            class="whitespace-nowrap px-3 py-1.5 text-sm transition-colors"
            class:bg-raised={(data.params.filtre ?? null) === item.value}
            class:text-muted={(data.params.filtre ?? null) !== item.value}
          >
            {item.label}
          </a>
        {/each}
      </div>
    {/if}
    <div
      class="flex flex-wrap rounded border border-line"
      role="group"
      aria-label={m.games_rarity()}
    >
      {#each tiers as item (item.value)}
        <a
          href={hrefWith({ niveau: data.params.niveau === item.value ? null : item.value })}
          data-sveltekit-reset="false"
          data-tier={item.tier}
          title={tierRule(item.tier)}
          aria-current={data.params.niveau === item.value ? 'true' : undefined}
          class="stat-value px-3 py-1.5 !text-sm transition-colors"
          class:bg-raised={data.params.niveau === item.value}
        >
          {item.label}
        </a>
      {/each}
    </div>

    <div class="ml-auto flex items-center gap-2">
      {#if filtered}
        <a href={clearHref} data-sveltekit-reset="false" class="text-sm text-muted hover:text-ink">
          {m.games_clear()}
        </a>
      {/if}
      <select
        class="input w-auto"
        aria-label={m.games_sort()}
        value={data.params.tri}
        onchange={(event) => apply({ tri: event.currentTarget.value })}
      >
        <option value="nom">{m.sort_name()}</option>
        <option value="succes">{m.sort_achievements()}</option>
        <option value="recent">{m.sort_recent()}</option>
        <option value="rarete">{m.sort_tier()}</option>
        {#if data.params.mine}<option value="progression">{m.sort_progress()}</option>{/if}
      </select>
      <a
        href={hrefWith({ vue: data.params.vue === 'grille' ? 'liste' : null })}
        data-sveltekit-reset="false"
        class="btn w-9 px-0"
        aria-label={data.params.vue === 'grille' ? m.view_list() : m.view_grid()}
      >
        {#if data.params.vue === 'grille'}<List size={16} />{:else}<LayoutGrid size={16} />{/if}
      </a>
    </div>
  </div>

  {#if data.params.mine}<TierLegend />{/if}

  {#if games.length === 0}
    {#if toLink}
      <Empty title={m.platform_unlinked_title({ platform: PLATFORM_LABELS[toLink] })}>
        {m.platform_unlinked_text()}
        {#snippet action()}<a href={`/compte#${toLink.toLowerCase()}`} class="btn btn-primary"
            >{m.link_account()}</a
          >{/snippet}
      </Empty>
    {:else if data.user && !data.player && !data.params.q && !data.params.plateforme && !data.params.filtre && !data.params.niveau}
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
          target={game.target}
          copies={game.copies}
          next={game.next}
          seasonEligible={game.seasonEligible}
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
          data-sveltekit-preload-data="false"
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
