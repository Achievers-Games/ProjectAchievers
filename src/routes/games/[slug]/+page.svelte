<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { tauriApi, type GameDetail } from '@/lib/tauri';
  import { toast } from '@/lib/stores/toast';
  import AchievementCard from '@/lib/games/AchievementCard.svelte';

  let game = $state<GameDetail | null>(null);
  let loading = $state(true);
  let syncing = $state(false);
  let filter = $state<'all' | 'unlocked' | 'locked'>('all');

  const slug = page.params.slug;

  onMount(async () => {
    try {
      const results = await tauriApi.searchGames(slug, 1);
      if (results.length === 0) {
        game = null;
      } else {
        game = await tauriApi.getGameDetail(results[0].id);
      }
    } catch {
      game = null;
    } finally {
      loading = false;
    }
  });

  const progress = $derived(game?.user_progress);
  const achievements = $derived(game?.achievements ?? []);
  const shown = $derived(
    achievements.filter((a) =>
      filter === 'all' ? true : filter === 'unlocked' ? a.unlocked : !a.unlocked,
    ),
  );
  const unlockedCount = $derived(achievements.filter((a) => a.unlocked).length);
  const percentage = $derived(progress?.completion_percentage ?? 0);

  async function resync() {
    if (!game) return;
    syncing = true;
    try {
      await tauriApi.forceSyncGame(game.id);
      toast.success(`« ${game.name} » re-synchronisé`);
    } catch (e) {
      toast.error('Échec de la re-synchronisation', e instanceof Error ? e.message : String(e));
    } finally {
      syncing = false;
    }
  }
</script>

<svelte:head><title>{game?.name ?? 'Jeu'} — Project Achievers</title></svelte:head>

{#if loading}
  <div class="skeleton-hero"></div>
{:else if !game}
  <div class="notfound dynamic-card">
    <h2>Jeu introuvable</h2>
    <p>Ce jeu n'est pas encore dans ta collection.</p>
    <a class="btn-glossy" href="/games">Retour à la bibliothèque</a>
  </div>
{:else}
  <div class="page">
    <!-- Héros -->
    <section class="hero">
      {#if game.header_url ?? game.cover_url}
        <div class="hero-bg">
          <img src={game.header_url ?? game.cover_url ?? ''} alt="" />
          <div class="hero-veil"></div>
        </div>
      {/if}

      <div class="hero-body">
        {#if game.cover_url}
          <img class="poster" src={game.cover_url} alt={game.name} />
        {/if}
        <div class="hero-info">
          <div class="badges">
            <span class="platform">{game.platform.charAt(0).toUpperCase() + game.platform.slice(1)}</span>
            {#if game.platinum_achievement_id}
              <span class="platinum">🏆 Platine disponible</span>
            {/if}
          </div>
          <h1>{game.name}</h1>
          <p class="sub">{unlockedCount} / {achievements.length} succès débloqués</p>
          <div class="progressline">
            <div class="bar"><i style="width: {Math.min(100, Math.max(0, percentage))}%"></i></div>
            <span class="pct">{percentage.toFixed(1)}%</span>
          </div>
        </div>
        <button class="btn-glossy" onclick={resync} disabled={syncing}>
          <svg class:spin={syncing} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5" /></svg>
          {syncing ? 'Synchronisation…' : 'Re-synchroniser'}
        </button>
      </div>
    </section>

    <!-- Stats -->
    <section class="stats">
      <div class="dynamic-card stat">
        <p class="label">Progression</p>
        <p class="stat-numeral value">{percentage.toFixed(1)}%</p>
      </div>
      <div class="dynamic-card stat">
        <p class="label">Succès débloqués</p>
        <p class="stat-numeral value">{unlockedCount}</p>
      </div>
      <div class="dynamic-card stat">
        <p class="label">Total</p>
        <p class="stat-numeral value">{achievements.length}</p>
      </div>
      <div class="dynamic-card stat">
        <p class="label">Platine</p>
        <p class="stat-numeral value">{progress?.platinum_unlocked ? 'Oui' : 'Non'}</p>
      </div>
    </section>

    <!-- Succès -->
    <section>
      <div class="list-head">
        <div>
          <h2>Succès</h2>
          <p class="section-sub">{unlockedCount} débloqués · {achievements.length - unlockedCount} restants</p>
        </div>
        <div class="tabs">
          <button class:active={filter === 'all'} onclick={() => (filter = 'all')}>Tous</button>
          <button class:active={filter === 'unlocked'} onclick={() => (filter = 'unlocked')}>Débloqués</button>
          <button class:active={filter === 'locked'} onclick={() => (filter = 'locked')}>Verrouillés</button>
        </div>
      </div>

      {#if shown.length === 0}
        <div class="empty dynamic-card">Aucun succès dans cette catégorie.</div>
      {:else}
        <div class="achievements">
          {#each shown as achievement (achievement.id)}
            <AchievementCard {achievement} />
          {/each}
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .skeleton-hero {
    height: 20rem;
    border-radius: 1.25rem;
    background: hsl(var(--secondary));
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .notfound {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 3rem 1rem;
    text-align: center;
  }

  .notfound h2 {
    font-size: 1.4rem;
    font-weight: 800;
  }

  .notfound p {
    font-size: 0.85rem;
    color: hsl(var(--muted-foreground));
  }

  /* Héros */
  .hero {
    position: relative;
    overflow: hidden;
    border-radius: 1.25rem;
    border: 1px solid hsl(var(--border) / 80%);
    background: hsl(var(--card));
  }

  .hero-bg {
    position: absolute;
    inset: 0;
  }

  .hero-bg img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.35;
  }

  .hero-veil {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, hsl(var(--card) / 20%), hsl(var(--card)) 92%),
      linear-gradient(90deg, hsl(var(--card)) 8%, transparent 65%);
  }

  .hero-body {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 1.25rem;
    padding: 1.5rem;
    min-height: 15rem;
  }

  .poster {
    width: 8.5rem;
    height: 11rem;
    object-fit: cover;
    border-radius: 1rem;
    border: 1px solid hsl(var(--border));
    box-shadow: 0 20px 50px -20px rgb(0 0 0 / 80%);
  }

  .hero-info {
    flex: 1;
    min-width: 15rem;
    padding-bottom: 0.25rem;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .platform,
  .platinum {
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    font-size: 0.6875rem;
    font-weight: 700;
    border: 1px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
  }

  .platform {
    border-color: hsl(214 100% 60% / 35%);
    background: hsl(214 100% 60% / 10%);
    color: hsl(214 100% 70%);
  }

  .platinum {
    border-color: hsl(203 89% 60% / 40%);
    background: hsl(203 89% 60% / 10%);
    color: hsl(203 89% 75%);
  }

  .hero-info h1 {
    font-size: clamp(1.6rem, 4vw, 2.4rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  .sub {
    margin-top: 0.35rem;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }

  .progressline {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.9rem;
    max-width: 26rem;
  }

  .bar {
    flex: 1;
    height: 0.4rem;
    border-radius: 9999px;
    background: hsl(var(--secondary));
    overflow: hidden;
  }

  .bar i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, hsl(15 92% 56%), hsl(42 95% 55%));
    transition: width 0.6s ease;
  }

  .pct {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    color: hsl(45 95% 65%);
  }

  .btn-glossy {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    height: 2.4rem;
    padding: 0 1rem;
    border: none;
    border-radius: 9999px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-glossy:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn-glossy svg {
    width: 0.95rem;
    height: 0.95rem;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Stats */
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  @media (min-width: 1024px) {
    .stats {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .stat {
    padding: 0.9rem 1rem;
  }

  .label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: hsl(var(--muted-foreground));
  }

  .value {
    margin-top: 0.3rem;
    font-size: 1.5rem;
  }

  /* Liste succès */
  .list-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.85rem;
  }

  .list-head h2 {
    font-size: 1.125rem;
    font-weight: 700;
  }

  .section-sub {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .tabs {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.2rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    background: hsl(var(--secondary) / 50%);
  }

  .tabs button {
    padding: 0.3rem 0.75rem;
    border: none;
    border-radius: 9999px;
    background: transparent;
    font-size: 0.72rem;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
  }

  .tabs button.active {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }

  .achievements {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: 1fr;
  }

  @media (min-width: 768px) {
    .achievements {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 1280px) {
    .achievements {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .empty {
    padding: 2rem;
    text-align: center;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }
</style>
