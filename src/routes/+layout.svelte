<script lang="ts">
  import '../globals.css';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import Sidebar from '@/lib/layout/Sidebar.svelte';
  import { toasts, type Toast } from '@/lib/stores/toast';
  import { initTheme } from '@/lib/stores/theme';
  import { tauriApi, type GameSearchResult } from '@/lib/tauri';
  import { auth as authStore } from '@/lib/stores/auth';
  import { authModalOpen } from '@/lib/stores/authModal';
  import AuthModal from '@/lib/components/AuthModal.svelte';

  let { children }: { children: Snippet } = $props();

  onMount(initTheme);
  onMount(() => {
    void authStore.init();
  });

  let sidebarOpen = $state(false);
  let globalSearch = $state('');
  let results = $state<GameSearchResult[]>([]);
  let searchOpen = $state(false);
  let searching = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const query = globalSearch.trim();
    if (searchTimer) clearTimeout(searchTimer);

    if (query.length < 2) {
      results = [];
      searching = false;
      return;
    }

    searching = true;
    searchTimer = setTimeout(async () => {
      try {
        const matches = await tauriApi.searchGames(query, 6);
        if (globalSearch.trim() === query) results = matches;
      } catch {
        results = [];
      } finally {
        if (globalSearch.trim() === query) searching = false;
      }
    }, 250);

    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });

  function submitSearch(event?: SubmitEvent) {
    event?.preventDefault();
    const query = globalSearch.trim();
    if (!query) return;
    searchOpen = false;
    goto(`/games?search=${encodeURIComponent(query)}`);
  }

  function openGame(game: GameSearchResult) {
    searchOpen = false;
    globalSearch = '';
    goto(`/games/${game.slug}`);
  }

  function closeOnFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    searchOpen = false;
  }

  function platformLabel(platform: string): string {
    if (platform === 'steam') return 'Steam';
    if (platform === 'psn') return 'PlayStation';
    if (platform === 'xbox') return 'Xbox';
    return 'Multi-plateforme';
  }

  const kindIcon: Record<Toast['kind'], string> = {
    success: 'M20 6 9 17l-5-5',
    error: 'M18 6 6 18M6 6l12 12',
    warning: 'M12 9v4m0 4h.01M12 5a7 7 0 1 0 0 14A7 7 0 0 0 12 5z',
  };
</script>

<div class="app">
  <div class="ambient -left-40 -top-40"></div>
  <div class="ambient -right-40 -bottom-56"></div>

  {#if sidebarOpen}
    <div class="overlay" onclick={() => (sidebarOpen = false)} aria-hidden="true"></div>
  {/if}

  <div class="drawer" class:open={sidebarOpen}>
    <Sidebar />
  </div>

  <div class="main">
    <header class="header">
      <button
        class="menu-btn"
        onclick={() => (sidebarOpen = !sidebarOpen)}
        aria-label="Ouvrir le menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>

      <form class="searchbeam" role="search" onsubmit={submitSearch} onfocusout={closeOnFocusOut}>
        <svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          type="search"
          placeholder="Rechercher un jeu…"
          aria-label="Rechercher un jeu"
          autocomplete="off"
          bind:value={globalSearch}
          onfocus={() => (searchOpen = true)}
          onkeydown={(event) => {
            if (event.key === 'Escape') {
              searchOpen = false;
              globalSearch = '';
            }
          }} />

        {#if searchOpen && globalSearch.trim().length >= 2}
          <div class="search-results">
            {#if searching}
              <p class="search-note">Recherche…</p>
            {:else if results.length === 0}
              <p class="search-note">Aucun jeu pour « {globalSearch.trim()} ».</p>
            {:else}
              {#each results as game (game.id)}
                <button type="button" class="search-hit" onclick={() => openGame(game)}>
                  {#if game.cover_url}
                    <img src={game.cover_url} alt="" />
                  {:else}
                    <span class="hit-fallback">🎮</span>
                  {/if}
                  <span class="hit-info">
                    <strong>{game.name}</strong>
                    <small>{platformLabel(game.platform)} · {game.total_achievements} succès</small>
                  </span>
                </button>
              {/each}
              <button type="button" class="search-all" onclick={() => submitSearch()}>
                Voir tous les résultats
              </button>
            {/if}
          </div>
        {/if}
      </form>

      <div class="eyebrow-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v1.5M12 19.5V21M4.9 4.9l1.1 1.1M18 18l1.1 1.1M2.8 12h1.5M19.7 12h1.5M4.9 19.1 6 18M18 6l1.1-1.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8" /></svg>
        Chasse aux succès
      </div>
    </header>

    <main class="content">{@render children()}</main>
  </div>

  <!-- Toasts -->
  <div class="toaststack">
    {#each $toasts as toast (toast.id)}
      <div class="toast {toast.kind}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d={kindIcon[toast.kind]} /></svg>
        <div>
          <p class="toast-msg">{toast.message}</p>
          {#if toast.description}
            <p class="toast-desc">{toast.description}</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if $authModalOpen}
    <AuthModal />
  {/if}
</div>

<style>
  .app {
    position: relative;
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .ambient {
    pointer-events: none;
    position: absolute;
    border-radius: 50%;
    filter: blur(64px);
    opacity: 0.6;
    background: radial-gradient(closest-side, hsl(var(--primary) / 18%), transparent 70%);
  }

  .drawer {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 50;
    width: 16rem;
    height: 100%;
    transition: transform 0.3s ease;
    transform: translateX(-100%);
  }

  .drawer.open {
    transform: translateX(0);
  }

  @media (min-width: 1024px) {
    .drawer {
      transform: translateX(0);
    }
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(0 0 0 / 60%);
    backdrop-filter: blur(4px);
  }

  .menu-btn {
    display: grid;
    place-items: center;
    padding: 0.5rem;
    border-radius: 0.75rem;
    color: hsl(var(--muted-foreground));
    transition: background 0.15s ease;
  }

  .menu-btn:hover {
    background: hsl(var(--secondary));
  }

  @media (min-width: 1024px) {
    .menu-btn {
      display: none;
    }
  }

  .main {
    position: relative;
    z-index: 10;
    display: flex;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
  }

  @media (min-width: 1024px) {
    .main {
      padding-left: 16rem;
    }
  }

  .header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid hsl(var(--border) / 60%);
    background: hsl(var(--background) / 70%);
    backdrop-filter: blur(20px);
  }

  .menu-btn svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  .searchbeam {
    position: relative;
    width: 100%;
    max-width: 28rem;
  }

  .search-ico {
    position: absolute;
    left: 0.875rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1rem;
    height: 1rem;
    color: hsl(var(--muted-foreground));
    pointer-events: none;
  }

  .searchbeam input {
    width: 100%;
    padding: 0.625rem 1rem 0.625rem 2.5rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border) / 70%);
    background: hsl(var(--secondary) / 50%);
    color: hsl(var(--foreground));
    font-size: 0.875rem;
    outline: none;
  }

  .searchbeam input:focus {
    border-color: hsl(var(--primary) / 40%);
  }

  .search-results {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    left: 0;
    z-index: 60;
    overflow: hidden;
    padding: 0.35rem;
    border: 1px solid hsl(var(--border));
    border-radius: 0.9rem;
    background: hsl(var(--card));
    box-shadow: 0 18px 40px -16px rgb(0 0 0 / 60%);
  }

  .search-note {
    padding: 0.6rem 0.65rem;
    font-size: 0.78rem;
    color: hsl(var(--muted-foreground));
  }

  .search-hit {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.45rem 0.5rem;
    border-radius: 0.6rem;
    text-align: left;
    transition: background 0.12s ease;
  }

  .search-hit:hover,
  .search-hit:focus-visible {
    background: hsl(var(--secondary));
  }

  .search-hit img,
  .hit-fallback {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 2.35rem;
    flex-shrink: 0;
    object-fit: cover;
    border-radius: 0.3rem;
    background: hsl(var(--secondary));
    font-size: 0.9rem;
  }

  .hit-info {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .hit-info strong {
    overflow: hidden;
    font-size: 0.8rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hit-info small {
    font-size: 0.65rem;
    color: hsl(var(--muted-foreground));
  }

  .search-all {
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem;
    border-top: 1px solid hsl(var(--border));
    font-size: 0.72rem;
    font-weight: 700;
    color: hsl(var(--primary));
  }

  .search-all:hover,
  .search-all:focus-visible {
    background: hsl(var(--secondary));
  }

  .eyebrow-badge {
    margin-left: auto;
    display: none;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    border: 1px solid hsl(var(--accent) / 25%);
    border-radius: 9999px;
    background: hsl(var(--accent) / 10%);
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: hsl(var(--accent));
    white-space: nowrap;
  }

  .eyebrow-badge svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  @media (min-width: 640px) {
    .eyebrow-badge {
      display: flex;
    }
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    color: hsl(var(--foreground));
  }

  @media (min-width: 1024px) {
    .content {
      padding: 2.5rem;
    }
  }

  .toaststack {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    min-width: 17rem;
    max-width: 24rem;
    padding: 0.75rem 1rem;
    border-radius: 1rem;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--card));
    box-shadow: 0 18px 40px -16px rgb(0 0 0 / 60%);
    animation: toast-in 0.25s ease-out both;
  }

  .toast svg {
    width: 1rem;
    height: 1rem;
    margin-top: 0.125rem;
  }

  .toast.success svg {
    color: hsl(142 71% 45%);
  }

  .toast.error svg {
    color: hsl(0 84% 60%);
  }

  .toast.warning svg {
    color: hsl(45 93% 53%);
  }

  .toast-msg {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .toast-desc {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    margin-top: 0.125rem;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
