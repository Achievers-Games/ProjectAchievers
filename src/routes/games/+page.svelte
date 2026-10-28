<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { tauriApi, type GameListItem } from '@/lib/tauri';
  import { toast } from '@/lib/stores/toast';
  import { gridFlip } from '@/lib/actions/flip';
  import GameCard from '@/lib/games/GameCard.svelte';

  type PlatformFilter = 'all' | 'steam' | 'psn';

  const platformFilters: { value: PlatformFilter; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'steam', label: 'Steam' },
    { value: 'psn', label: 'PlayStation' },
  ];

  let games = $state<GameListItem[] | null>(null);
  let localSearch = $state(page.url.searchParams.get('search') ?? '');
  let localPlatform = $state<PlatformFilter>('all');
  let syncing = $state(false);
  let authLoaded = $state(false);
  let hasLinkedAccount = $state(false);

  onMount(async () => {
    try {
      const auth = await tauriApi.getAuthStatus();
      hasLinkedAccount = auth.linked_accounts.length > 0;
    } catch {
      hasLinkedAccount = false;
    } finally {
      authLoaded = true;
    }
  });

  // La recherche globale de l'en-tête arrive via ?search=…
  afterNavigate(() => {
    localSearch = page.url.searchParams.get('search') ?? '';
  });

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (searchTimer) clearTimeout(searchTimer);
    const platform = localPlatform; // dépendance : pill
    const search = localSearch; // debouncé ci-dessous
    searchTimer = setTimeout(() => {
      void load(platform, search);
    }, 300);
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });

  async function load(platform: PlatformFilter, search: string) {
    const data = await tauriApi.getGames({
      platform: platform === 'all' ? undefined : platform,
      search: search || undefined,
    });
    games = data;
  }

  async function handleSync() {
    syncing = true;
    try {
      await tauriApi.syncAllPlatforms();
      await load(localPlatform, localSearch.trim());
      toast.success('Synchronisation terminée');
    } catch (e) {
      toast.error('Échec de la synchronisation', e instanceof Error ? e.message : String(e));
    } finally {
      syncing = false;
    }
  }
</script>

<svelte:head><title>Project Achievers — Bibliothèque</title></svelte:head>

<div class="page">
  <!-- En-tête -->
  <div class="header reveal">
    <div class="glow">
      <div class="header-inner">
        <div>
          <p class="eyebrow">Collection</p>
          <h1>Bibliothèque</h1>
          <p class="sub">
            {games?.length ?? 0}
            {(games?.length ?? 0) > 1 ? 'jeux découverts' : 'jeu découvert'}
          </p>
        </div>
        {#if !authLoaded || hasLinkedAccount}
          <button class="btn-glossy" onclick={handleSync} disabled={syncing}>
            <svg class:spin={syncing} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5" /></svg>
            {syncing ? 'Synchronisation…' : 'Synchroniser'}
          </button>
        {:else}
          <a class="btn-glossy" href="/settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 7h3a5 5 0 0 1 0 10h-3M9 17H6a5 5 0 0 1 0-10h3M8 12h8" /></svg>
            Lier Steam
          </a>
        {/if}
      </div>
    </div>
  </div>

  <!-- Recherche + filtres -->
  <div class="filters">
    <div class="searchbeam">
      <svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      <input type="search" placeholder="Rechercher un jeu…" bind:value={localSearch} />
    </div>

    {#each platformFilters as filter (filter.value)}
      <button
        class="pill"
        class:active={localPlatform === filter.value}
        onclick={() => (localPlatform = filter.value)}
      >
        {filter.label}
      </button>
    {/each}
  </div>

  <!-- Contenu -->
  {#if games === null}
    <div class="grid" use:gridFlip>
      {#each { length: 8 } as _, i (i)}
        <div class="card-skeleton">
          <div class="skeleton-block"></div>
          <div class="skeleton-lines">
            <div class="skeleton-text w-3-4"></div>
            <div class="skeleton-text w-full"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else if games.length === 0}
    <div class="empty dynamic-card">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h4m-2-2v4M15 11h.01M18 13h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.59A17.9 17.9 0 0 0 2.25 12c0 2 .19 4 .53 5.8A4 4 0 0 0 6.68 21h8.64a4 4 0 0 0 3.98-3.6c.35-1.86.53-3.96.53-5.81 0-2-.18-3.94-.53-5.81A4 4 0 0 0 17.32 5z" /></svg>
      <h3>Aucun jeu trouvé</h3>
      <p>Lie ton compte Steam pour importer ta bibliothèque.</p>
      <a class="btn-glossy" href="/settings">Lier Steam</a>
    </div>
  {:else}
    <div class="grid" use:gridFlip>
      {#each games as game (game.id)}
        <GameCard {game} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .header {
    position: relative;
    border-radius: 1.25rem;
    padding: 1.5rem;
    background: linear-gradient(180deg, hsl(var(--card)), hsl(var(--card) / 60%));
    border: 1px solid hsl(var(--border) / 80%);
  }

  .glow {
    position: relative;
  }

  .glow::before {
    pointer-events: none;
    content: '';
    position: absolute;
    top: -6rem;
    left: -5rem;
    width: 14rem;
    height: 14rem;
    border-radius: 50%;
    background: radial-gradient(closest-side, hsl(15 92% 56% / 20%), transparent);
  }

  .header-inner {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  @media (min-width: 1024px) {
    .header-inner {
      flex-direction: row;
      align-items: flex-end;
      justify-content: space-between;
    }
  }

  .eyebrow {
    display: inline-block;
    margin-bottom: 0.5rem;
    padding: 0.25rem 0.75rem;
    border: 1px solid hsl(var(--accent) / 25%);
    border-radius: 9999px;
    background: hsl(var(--accent) / 10%);
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: hsl(var(--accent));
  }

  h1 {
    font-size: clamp(1.75rem, 4vw, 2.375rem);
    font-weight: 800;
    letter-spacing: -0.03em;
  }

  .sub {
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
  }

  .btn-glossy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    height: 2.5rem;
    padding: 0 1rem;
    background: hsl(var(--primary));
    border: none;
    color: hsl(var(--primary-foreground));
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .btn-glossy:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn-glossy svg {
    width: 1rem;
    height: 1rem;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .searchbeam {
    position: relative;
    width: 100%;
  }

  @media (min-width: 640px) {
    .searchbeam {
      width: 18rem;
    }
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

  .pill {
    padding: 0.375rem 0.875rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    background: transparent;
    color: hsl(var(--muted-foreground));
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .pill.active {
    background: hsl(var(--primary));
    border-color: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }

  /* Grille de cartes */
  .grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  /* Skeleton */
  .card-skeleton {
    border-radius: 1.25rem;
    border: 1px solid hsl(var(--border) / 80%);
    overflow: hidden;
  }

  .skeleton-block {
    aspect-ratio: 10 / 6;
    background: hsl(var(--secondary));
    animation: pulse 1.5s ease-in-out infinite;
  }

  .skeleton-lines {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
  }

  .skeleton-text {
    height: 0.5rem;
    border-radius: 0.25rem;
    background: hsl(var(--secondary));
    animation: pulse 1.5s ease-in-out infinite;
  }

  .w-3-4 {
    width: 75%;
  }

  .w-full {
    width: 100%;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Empty state */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    text-align: center;
  }

  .empty svg {
    width: 2.25rem;
    height: 2.25rem;
    opacity: 0.3;
  }

  .empty h3 {
    font-size: 1.125rem;
    font-weight: 700;
  }

  .empty p {
    max-width: 24rem;
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
  }
</style>
