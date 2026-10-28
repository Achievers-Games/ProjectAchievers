<script lang="ts">
  import { onMount } from 'svelte';
  import { tauriApi, type AuthStatus, type GameListItem } from '@/lib/tauri';
  import { formatNumber } from '@/lib/utils';
  import { toast } from '@/lib/stores/toast';
  import { openAuthModal } from '@/lib/stores/authModal';
  import GameCard from '@/lib/games/GameCard.svelte';

  let games = $state<GameListItem[] | null>(null);
  let authStatus = $state<AuthStatus | null>(null);
  let syncing = $state(false);

  onMount(async () => {
    const [g, a] = await Promise.allSettled([tauriApi.getGames(), tauriApi.getAuthStatus()]);
    if (g.status === 'fulfilled') games = g.value;
    if (a.status === 'fulfilled') authStatus = a.value;
  });

  const hasLinkedAccount = $derived(
    (authStatus?.linked_accounts?.length ?? 0) > 0,
  );

  async function handleSync() {
    syncing = true;
    try {
      await tauriApi.syncAllPlatforms();
      games = await tauriApi.getGames();
      toast.success('Synchronisation terminée');
    } catch (e) {
      toast.error('Échec de la synchronisation', e instanceof Error ? e.message : String(e));
    } finally {
      syncing = false;
    }
  }

  const stats = $derived({
    totalGames: games?.length ?? 0,
    totalAchievements: games?.reduce((acc, g) => acc + g.total_achievements, 0) ?? 0,
    unlocked: games?.reduce((acc, g) => acc + (g.user_progress?.unlocked_count ?? 0), 0) ?? 0,
    platinums: games?.filter((g) => g.user_progress?.platinum_unlocked).length ?? 0,
  });

  const nearComplete = $derived(
    games
      ?.filter(
        (g) =>
          g.user_progress &&
          !g.user_progress.platinum_unlocked &&
          (g.user_progress.completion_percentage ?? 0) > 0,
      )
      .sort(
        (a, b) =>
          (b.user_progress?.completion_percentage ?? 0) - (a.user_progress?.completion_percentage ?? 0),
      )
      .slice(0, 3) ?? [],
  );
</script>

<svelte:head><title>Project Achievers — Accueil</title></svelte:head>

<div class="page">
  <!-- Hero -->
  <section class="hero reveal">
    <div class="glow-a"></div>
    <div class="glow-b"></div>

    <div class="hero-inner">
      <div>
        <p class="saison">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" /></svg>
          Saison · Automne 2026
        </p>
        <h1>
          Bonjour, <span class="stat-numeral">{authStatus?.username || 'Chasseur'}</span>
        </h1>
        <p class="hero-sub">
          Ta bibliothèque, tes trophées, tes guides — tout au même endroit pour développer ta
          collection, un succès à la fois.
        </p>
      </div>

      <div class="hero-actions">
        {#if hasLinkedAccount}
          <button class="btn-glossy" onclick={handleSync} disabled={syncing}>
            <svg class:spin={syncing} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5" /></svg>
            {syncing ? 'Synchronisation…' : 'Synchroniser'}
          </button>
        {:else}
          <button class="btn-glossy" onclick={() => openAuthModal()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 7h3a5 5 0 0 1 0 10h-3M9 17H6a5 5 0 0 1 0-10h3M8 12h8" /></svg>
            Lier un compte
          </button>
        {/if}
        <a href="/games" class="ghost-link">
          Explorer la bibliothèque
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </a>
      </div>
    </div>
  </section>

  <!-- Stats -->
  <section class="stats">
    {@render StatCard({ title: 'Jeux', value: formatNumber(stats.totalGames), path: 'M6 12h4m-2-2v4M15 11h.01M18 13h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.59A17.9 17.9 0 0 0 2.25 12c0 2 .18 3.94.52 5.8A4 4 0 0 0 6.68 21h8.64a4 4 0 0 0 3.98-3.6c.35-2.19.53-3.96.53-5.81 0-2-.18-3.94-.53-5.81A4 4 0 0 0 17.32 5z', delay: '1' })}
    {@render StatCard({ title: 'Succès', value: formatNumber(stats.totalAchievements), path: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M6 9v3.2A13.7 13.7 0 0 0 12 19a13.7 13.7 0 0 0 6-6.8V9M8.2 13.9a7.9 7.9 0 0 0 3.8 4M8.2 6h7.6M6 4h12v11a12 12 0 0 1-12 0z', delay: '1' })}
    {@render StatCard({ title: 'Déverrouillés', value: formatNumber(stats.unlocked), path: 'M8.2 13.9a7.9 7.9 0 0 0 3.8 4M13 11l3-2M8.2 13.5c.4.9 1 1.7 1.8 2.4M8.2 16h7.6M6 4h12v11a12 12 0 0 1-12 0z M6 9v3.2A13.7 13.7 0 0 0 12 19a13.7 13.7 0 0 0 6-6.8V9', delay: '2' })}
    {@render StatCard({ title: 'Platiniums', value: formatNumber(stats.platinums), path: 'M6 11v1.2A13.7 13.7 0 0 0 12 19a13.7 13.7 0 0 0 6-6.8V11M6 9v3.2M18 12.2V9M8.2 9h7.6M6 4h12v5a12 12 0 0 1-12 0z M6 9v2.2a13.7 13.7 0 0 0 12 0V9', delay: '3' })}
  </section>

  <!-- Presse-boutons -->
  {#if nearComplete.length > 0}
    <section class="reveal">
      <h2 class="section-title">Presse-boutons</h2>
      <p class="section-sub">Tu es tout proche du platine.</p>
      <div class="grid">
        {#each nearComplete as game (game.id)}
          <GameCard {game} />
        {/each}
      </div>
    </section>
  {/if}

  <!-- Bibliothèque -->
  <section>
    <div class="section-head">
      <div>
        <h2 class="section-title">Ta bibliothèque</h2>
        <p class="section-sub">
          {formatNumber(stats.totalGames)} {stats.totalGames > 1 ? 'jeux découverts' : 'jeu découvert'}
        </p>
      </div>
      <a href="/games" class="see-all">
        Tout voir
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
      </a>
    </div>

    {#if games === null}
      <div class="grid">
        {#each { length: 6 } as _, i (i)}
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
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M8.2 6h7.6M6 4h12v11a12 12 0 0 1-12 0z" /></svg>
        <p>Aucun jeu trouvé. Lie ton compte Steam pour commencer.</p>
        <button class="btn-glossy" onclick={() => openAuthModal()}>Lier Steam</button>
      </div>
    {:else}
      <div class="grid">
        {#each games as game (game.id)}
          <GameCard {game} />
        {/each}
      </div>
    {/if}
  </section>
</div>

{#snippet StatCard({ title, value, path, delay }: { title: string; value: string; path: string; delay: string })}
  <div class="dynamic-card stat-card reveal reveal-delay-{delay}">
    <div class="stat-top">
      <p class="stat-label">{title}</p>
      <div class="stat-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d={path} /></svg></div>
    </div>
    <p class="stat-numeral stat-value">{value}</p>
  </div>
{/snippet}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  /* Hero */
  .hero {
    position: relative;
    overflow: hidden;
    border-radius: 1.25rem;
    border: 1px solid hsl(var(--border) / 80%);
    background: linear-gradient(180deg, hsl(var(--card)), hsl(var(--card) / 60%));
    box-shadow: 0 1px 0 0 rgb(255 255 255 / 4%) inset, 0 8px 24px -12px rgb(0 0 0 / 60%);
  }

  .glow-a {
    pointer-events: none;
    position: absolute;
    top: -6rem;
    left: -4rem;
    width: 16rem;
    height: 16rem;
    border-radius: 50%;
    background: radial-gradient(closest-side, hsl(15 92% 56% / 25%), transparent);
  }

  .glow-b {
    pointer-events: none;
    position: absolute;
    bottom: -8rem;
    right: 0;
    width: 16rem;
    height: 16rem;
    border-radius: 50%;
    background: radial-gradient(closest-side, hsl(42 95% 55% / 18%), transparent);
  }

  .hero-inner {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
  }

  @media (min-width: 640px) {
    .hero-inner {
      padding: 2rem;
    }
  }

  @media (min-width: 1024px) {
    .hero-inner {
      flex-direction: row;
      align-items: flex-end;
      justify-content: space-between;
    }
  }

  .saison {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    padding: 0.25rem 0.75rem;
    border: 1px solid hsl(var(--primary) / 25%);
    border-radius: 9999px;
    background: hsl(var(--primary) / 10%);
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: hsl(var(--primary));
  }

  .saison svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  h1 {
    font-size: clamp(1.75rem, 4vw, 2.375rem);
    font-weight: 800;
    letter-spacing: -0.03em;
  }

  .hero-sub {
    max-width: 36rem;
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
  }

  .hero-actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  @media (min-width: 640px) {
    .hero-actions {
      flex-direction: row;
    }
  }

  @media (min-width: 1024px) {
    .hero-actions {
      padding-bottom: 0.25rem;
    }
  }

  .hero-actions .btn-glossy {
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
    white-space: nowrap;
  }

  .hero-actions .btn-glossy:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .hero-actions .btn-glossy svg {
    width: 1rem;
    height: 1rem;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .ghost-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    height: 2.5rem;
    padding: 0 1rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .ghost-link:hover {
    border-color: hsl(var(--primary) / 40%);
    color: hsl(var(--foreground));
  }

  .ghost-link svg {
    width: 1rem;
    height: 1rem;
  }

  /* Stats */
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  @media (min-width: 1024px) {
    .stats {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .stat-card {
    padding: 1rem;
  }

  .stat-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .stat-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: hsl(var(--muted-foreground));
  }

  .stat-ico {
    display: grid;
    place-items: center;
    padding: 0.5rem;
    border-radius: 0.75rem;
    background: hsl(var(--secondary) / 60%);
    color: hsl(var(--muted-foreground));
  }

  .stat-ico svg {
    width: 1rem;
    height: 1rem;
  }

  .stat-value {
    margin-top: 0.5rem;
    font-size: clamp(1.3rem, 2.5vw, 1.75rem);
  }

  /* Sections */
  .section-title {
    font-size: 1.125rem;
    font-weight: 700;
  }

  .section-sub {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .section-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .see-all {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: hsl(var(--primary));
  }

  .see-all:hover {
    text-decoration: underline;
  }

  .see-all svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  /* Grilles */
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
    padding: 2.5rem 0;
    text-align: center;
    border-radius: 1.25rem;
    border: 1px solid hsl(var(--border) / 80%);
    background: linear-gradient(180deg, hsl(var(--card)), hsl(var(--card) / 60%));
  }

  .empty svg {
    width: 2.25rem;
    height: 2.25rem;
    opacity: 0.3;
  }

  .empty p {
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
  }

  .empty .btn-glossy {
    display: inline-flex;
    align-items: center;
    height: 2.5rem;
    padding: 0 1rem;
    background: hsl(var(--primary));
    border: none;
    color: hsl(var(--primary-foreground));
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    font-style: normal;
  }
</style>
