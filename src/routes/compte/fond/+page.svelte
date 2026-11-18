<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { snapshot } from '$app/navigation';
  import { page } from '$app/state';
  import Check from '@lucide/svelte/icons/check';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Ban from '@lucide/svelte/icons/ban';
  import PanelTop from '@lucide/svelte/icons/panel-top';
  import Wallpaper from '@lucide/svelte/icons/wallpaper';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Avatar from '#lib/components/Avatar.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import { cssArt } from '#lib/art';
  import { submitWithToast } from '#lib/forms';

  let { data } = $props();

  const submit = submitWithToast({ reset: false });

  const art = (images: string[]) => images.map((image) => `url("${encodeURI(image)}")`).join(', ');

  type Look = (typeof data.preview)['banner'];

  /** Ce que porte une cible aujourd'hui, en quelques mots : « Auto · Hades », « Fond Steam »… */
  function lookLabel({ mode, art }: Look) {
    if (mode === 'off') return m.appearance_none();
    if (mode === 'steam') return m.appearance_steam();
    if (mode === 'auto')
      return art?.name ? `${m.appearance_auto()} · ${art.name}` : m.appearance_auto();
    return art?.name ?? '';
  }

  const targets = $derived([
    {
      value: 'banniere',
      label: m.banner_title(),
      desc: m.appearance_banner_desc(),
      look: data.preview.banner,
      Icon: PanelTop,
    },
    {
      value: 'fond',
      label: m.background_page(),
      desc: m.appearance_background_desc(),
      look: data.preview.background,
      Icon: Wallpaper,
    },
  ]);
  const isBanner = $derived(data.target === 'banniere');
  const offLabel = $derived(isBanner ? m.banner_off() : m.background_off());

  type Game = (typeof data.games)[number];

  // La grille arrive par pages, comme la liste des jeux : la suivante se lit en approchant du bas.
  let extra = $state<Game[]>([]);
  let loadedPages = $state(0);
  let loadedFor = $state<string | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let request: AbortController | undefined;

  /** Après un choix, la première page se relit : un jeu déjà là ne doit pas revenir deux fois. */
  const games = $derived([
    ...new Map([...data.games, ...extra].map((game) => [game.id, game])).values(),
  ]);
  const nextPage = $derived(2 + loadedPages);
  const hasMore = $derived(nextPage <= data.pages);

  // Autre onglet ou autre recherche : la grille repart de la page rendue par le serveur.
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
    const query = new URLSearchParams({ cible: data.target, q: data.q, page: String(nextPage) });
    try {
      const response = await fetch(`/compte/fond/jeux?${query}`, { signal });
      if (!response.ok) throw new Error(`Réponse ${response.status}`);
      extra = [...extra, ...((await response.json()) as { games: Game[] }).games];
      loadedPages += 1;
      loading = false;
    } catch {
      if (signal.aborted) return;
      failed = true;
      loading = false;
    }
  }

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

  snapshot<{ extra: Game[]; loadedPages: number; loadedFor: string | null }>({
    capture: () => ({ extra: $state.snapshot(extra), loadedPages, loadedFor }),
    restore: (saved) => {
      extra = saved.extra;
      loadedPages = saved.loadedPages;
      loadedFor = saved.loadedFor;
    },
  });
</script>

<svelte:head><title>{m.appearance_title()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-8">
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div class="space-y-1">
      <h1>{m.appearance_title()}</h1>
      <p class="text-sm text-muted">{m.appearance_hint()}</p>
    </div>
    <a href="/u/{data.handle}" class="btn">
      {m.background_see_profile()}
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  </header>

  <!-- Le profil en miniature : le fond derrière, la bannière dedans. Chaque zone se choisit d'un
       clic, et celle qu'on règle est entourée. -->
  <section
    class="look-preview"
    aria-label={m.appearance_preview()}
    style:--page-art={data.preview.background.art
      ? cssArt(data.preview.background.art.images)
      : undefined}
  >
    <a
      href="?cible=fond"
      class="look-page"
      aria-current={!isBanner ? 'page' : undefined}
      aria-label="{m.background_page()} : {lookLabel(data.preview.background)}"
    >
      <span class="look-chip"><Wallpaper size={13} aria-hidden="true" />{m.background_page()}</span>
    </a>
    <a
      href="?cible=banniere"
      class="look-banner"
      aria-current={isBanner ? 'page' : undefined}
      aria-label="{m.banner_title()} : {lookLabel(data.preview.banner)}"
      style:--art={data.preview.banner.art ? cssArt(data.preview.banner.art.images) : undefined}
    >
      {#if data.preview.person}
        <Avatar person={data.preview.person} size={44} />
        <span class="look-name">{data.preview.person.displayName}</span>
      {/if}
      <span class="look-chip"><PanelTop size={13} aria-hidden="true" />{m.banner_title()}</span>
    </a>
    <div class="look-blocks" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  </section>

  <nav class="grid gap-3 sm:grid-cols-2" aria-label={m.appearance_title()}>
    {#each targets as target (target.value)}
      <a
        href="?cible={target.value}"
        class="look-target"
        aria-current={data.target === target.value ? 'page' : undefined}
      >
        <span class="look-target-icon"><target.Icon size={18} aria-hidden="true" /></span>
        <span class="min-w-0">
          <span class="block font-semibold text-ink">{target.label}</span>
          <span class="block text-xs text-muted">{target.desc}</span>
          <span class="mt-1 block truncate text-xs font-medium text-accent">
            {lookLabel(target.look)}
          </span>
        </span>
      </a>
    {/each}
  </nav>

  <section class="space-y-3">
    <h2>{m.appearance_source()}</h2>
    <form method="POST" action="?/mode" use:enhance={submit} class="look-options">
      <input type="hidden" name="cible" value={data.target} />
      <button name="mode" value="auto" class="look-option" aria-pressed={data.mode === 'auto'}>
        <span class="look-option-icon"><Sparkles size={18} aria-hidden="true" /></span>
        <span class="min-w-0">
          <span class="block font-semibold">{m.appearance_auto()}</span>
          <span class="block text-xs text-muted">{m.appearance_auto_desc()}</span>
        </span>
        {#if data.mode === 'auto'}<Check
            size={16}
            class="ml-auto text-accent"
            aria-hidden="true"
          />{/if}
      </button>
      {#if data.steam}
        <button
          name="mode"
          value="steam"
          class="look-option"
          aria-pressed={data.mode === 'steam'}
          disabled={!data.steam.url}
          title={data.steam.url ? undefined : m.background_steam_none()}
        >
          <span
            class="look-option-icon look-option-thumb"
            style:--art={data.steam.url ? art([data.steam.url]) : undefined}
          >
            {#if data.steam.motion}
              <video
                src={data.steam.motion}
                poster={data.steam.url}
                autoplay
                muted
                loop
                playsinline
                aria-hidden="true"
              ></video>
            {/if}
          </span>
          <span class="min-w-0">
            <span class="block font-semibold">{m.appearance_steam()}</span>
            <span class="block text-xs text-muted">
              {data.steam.url ? m.appearance_steam_desc() : m.background_steam_none()}
            </span>
          </span>
          {#if data.mode === 'steam'}<Check
              size={16}
              class="ml-auto text-accent"
              aria-hidden="true"
            />{/if}
        </button>
      {/if}
      <button name="mode" value="off" class="look-option" aria-pressed={data.mode === 'off'}>
        <span class="look-option-icon"><Ban size={18} aria-hidden="true" /></span>
        <span class="min-w-0">
          <span class="block font-semibold">{offLabel}</span>
          <span class="block text-xs text-muted">{m.appearance_none_desc()}</span>
        </span>
        {#if data.mode === 'off'}<Check
            size={16}
            class="ml-auto text-accent"
            aria-hidden="true"
          />{/if}
      </button>
    </form>
  </section>

  <section class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2>{m.appearance_game()}</h2>
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
    </div>

    {#if games.length}
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each games as game (game.id)}
          {@const current = data.mode === 'game' && data.chosen === game.id}
          <li>
            <form method="POST" action="?/choose" use:enhance={submit}>
              <input type="hidden" name="game" value={game.id} />
              <input type="hidden" name="cible" value={data.target} />
              <button
                class="background-tile"
                aria-pressed={current}
                aria-label={isBanner
                  ? m.banner_choose({ game: game.name })
                  : m.background_choose({ game: game.name })}
              >
                <!-- Une image par jeu, chargée en arrivant à l'écran : les fonds de boutique n'ont
                     pas de vignette, et la page en propose des dizaines. -->
                <img
                  src={game.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="background-tile-img"
                />
                <span class="background-tile-name">{game.name}</span>
                {#if current}
                  <span class="background-tile-check" aria-hidden="true"><Check size={14} /></span>
                {/if}
              </button>
            </form>
          </li>
        {/each}
      </ul>
      {#if hasMore}
        {#key nextPage}
          <div class="mt-4 flex justify-center" use:whenNear>
            <button type="button" class="btn" disabled={loading} onclick={loadMore}>
              {#if loading}{m.loading()}{:else if failed}{m.retry()}{:else}{m.show_more()}{/if}
            </button>
          </div>
        {/key}
      {/if}
    {:else}
      <Empty title={m.showcase_no_results()} />
    {/if}
  </section>

  <a href="/compte" class="btn">{m.my_account()}</a>
</div>

<style>
  /* Le profil en miniature, à la proportion d'un écran large. */
  .look-preview {
    position: relative;
    aspect-ratio: 16 / 7;
    overflow: hidden;
    border-radius: 0.75rem;
    border: 1px solid var(--color-line);
    background-color: rgb(12 11 22);
    background-image:
      linear-gradient(rgb(8 6 18 / 0.45), rgb(8 6 18 / 0.7)), var(--page-art, none),
      linear-gradient(115deg, #1a1430, #0d0a1c);
    background-position: center;
    background-size: cover;
  }
  .look-page {
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .look-banner {
    position: absolute;
    inset: 9% 7% auto;
    height: 40%;
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid rgb(255 255 255 / 0.12);
    background-color: rgb(12 11 22);
    background-image:
      linear-gradient(90deg, rgb(8 6 18 / 0.85) 10%, rgb(8 6 18 / 0.3) 70%), var(--art, none),
      linear-gradient(115deg, #2a0f3f, #0d0a1c);
    background-position: center;
    background-size: cover;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
  }
  .look-name {
    font-size: 1.125rem;
    font-weight: 800;
    color: white;
    text-shadow: 0 2px 8px rgb(0 0 0 / 0.7);
  }
  /* Quelques blocs flous : la place des statistiques et de la vitrine, sans rien à lire. */
  .look-blocks {
    position: absolute;
    inset: auto 7% 9%;
    height: 30%;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.625rem;
    pointer-events: none;
  }
  .look-blocks i {
    border-radius: 0.5rem;
    border: 1px solid rgb(255 255 255 / 0.08);
    background: rgb(21 20 36 / 0.55);
    backdrop-filter: blur(6px);
  }
  /* L'étiquette de chaque zone ; celle qu'on règle est entourée et marquée. */
  .look-chip {
    position: absolute;
    top: 0.625rem;
    right: 0.625rem;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    border-radius: 999px;
    border: 1px solid rgb(255 255 255 / 0.2);
    background: rgb(0 0 0 / 0.55);
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: rgb(255 255 255 / 0.85);
    backdrop-filter: blur(4px);
  }
  .look-page .look-chip {
    top: auto;
    bottom: 0.625rem;
    right: auto;
    left: 0.625rem;
  }
  .look-page,
  .look-banner {
    outline: 2px solid transparent;
    outline-offset: -2px;
    transition: outline-color 0.15s;
  }
  .look-page:hover,
  .look-banner:hover {
    outline-color: rgb(255 255 255 / 0.35);
  }
  .look-page[aria-current='page'],
  .look-banner[aria-current='page'] {
    outline: 3px solid var(--color-accent);
  }
  [aria-current='page'] > .look-chip {
    border-color: transparent;
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .look-page:focus-visible,
  .look-banner:focus-visible {
    outline: 3px solid var(--color-accent);
  }

  .look-target,
  .look-option {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    border-radius: 0.625rem;
    border: 2px solid var(--color-line);
    background: var(--color-surface);
    padding: 0.75rem 0.875rem;
    text-align: left;
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }
  .look-target:hover,
  .look-option:not(:disabled):hover {
    border-color: rgb(var(--accent) / 0.6);
  }
  .look-target[aria-current='page'],
  .look-option[aria-pressed='true'] {
    border-color: var(--color-accent);
    background: rgb(var(--accent) / 0.1);
  }
  .look-option:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .look-target-icon,
  .look-option-icon {
    position: relative;
    display: grid;
    flex-shrink: 0;
    place-items: center;
    height: 2.5rem;
    width: 2.5rem;
    overflow: hidden;
    border-radius: 0.5rem;
    background: var(--color-raised);
    color: var(--color-ink);
  }
  .look-target[aria-current='page'] .look-target-icon {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .look-option-thumb {
    width: 4rem;
    background-image: var(--art, none);
    background-position: center;
    background-size: cover;
  }
  .look-option-thumb video {
    position: absolute;
    inset: 0;
    height: 100%;
    width: 100%;
    object-fit: cover;
  }
  .look-options {
    display: grid;
    gap: 0.75rem;
  }
  @media (min-width: 640px) {
    .look-options {
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    }
  }
  /* Sur téléphone, la bannière prend la place et les blocs décoratifs s'effacent : sinon
     l'étiquette du fond se perd dessous. */
  @media (max-width: 639px) {
    .look-preview {
      aspect-ratio: 16 / 10;
    }
    .look-banner {
      height: 52%;
    }
    .look-blocks {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .look-option-thumb video {
      display: none;
    }
  }
</style>
