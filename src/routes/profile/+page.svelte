<script lang="ts">
  import { onMount } from 'svelte';
  import { tauriApi, type AuthStatus, type GameListItem } from '@/lib/tauri';

  let auth = $state<AuthStatus | null>(null);
  let games = $state<GameListItem[] | null>(null);

  onMount(async () => {
    const [a, g] = await Promise.allSettled([tauriApi.getAuthStatus(), tauriApi.getGames()]);
    if (a.status === 'fulfilled') auth = a.value;
    if (g.status === 'fulfilled') games = g.value;
  });

  const steam = $derived(auth?.linked_accounts.find((a) => a.platform === 'steam'));
  const psn = $derived(auth?.linked_accounts.find((a) => a.platform === 'psn'));

  const stats = $derived({
    games: games?.length ?? 0,
    unlocked: games?.reduce((sum, g) => sum + (g.user_progress?.unlocked_count ?? 0), 0) ?? 0,
    platinums: games?.filter((g) => g.user_progress?.platinum_unlocked).length ?? 0,
    total: games?.reduce((sum, g) => sum + g.total_achievements, 0) ?? 0,
  });

  const showcase = $derived(
    (games ?? [])
      .filter((g) => g.user_progress && (g.user_progress.completion_percentage ?? 0) > 0)
      .sort(
        (a, b) => (b.user_progress?.completion_percentage ?? 0) - (a.user_progress?.completion_percentage ?? 0),
      )
      .slice(0, 4),
  );
</script>

<svelte:head><title>Profil — Project Achievers</title></svelte:head>

<div class="page">
  <!-- Bannière profil -->
  <section class="profile-hero">
    <div class="banner">
      <div class="banner-glow"></div>
    </div>
    <div class="identity">
      <div class="avatar">
        {#if steam?.avatar_url}
          <img src={steam.avatar_url} alt={auth?.username ?? 'Avatar'} />
        {:else}
          <span>{(auth?.username ?? '?').charAt(0).toUpperCase()}</span>
        {/if}
        <i class="status-dot" class:online={auth?.is_authenticated}></i>
      </div>
      <div class="who">
        <div class="name-row">
          <h1>{auth?.username ?? 'Chasseur'}</h1>
          {#if steam || psn}
            <span class="verified-pill">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 12 2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
              Compte lié
            </span>
          {:else}
            <span class="verified-pill local">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              Profil local
            </span>
          {/if}
        </div>
        <p class="tagline">Chasseur de succès · Collectionneur de platines</p>
      </div>
      <a href="/settings" class="btn-ghost">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        Modifier
      </a>
    </div>
  </section>

  <!-- Stats -->
  <section class="stats">
    <div class="dynamic-card stat">
      <p class="label">Jeux suivis</p>
      <p class="stat-numeral value">{stats.games}</p>
    </div>
    <div class="dynamic-card stat">
      <p class="label">Succès débloqués</p>
      <p class="stat-numeral value">{stats.unlocked}</p>
    </div>
    <div class="dynamic-card stat">
      <p class="label">Platinums</p>
      <p class="stat-numeral value">{stats.platinums}</p>
    </div>
    <div class="dynamic-card stat">
      <p class="label">Succès disponibles</p>
      <p class="stat-numeral value">{stats.total}</p>
    </div>
  </section>

  <!-- Comptes liés -->
  <section class="accounts">
    <div class="dynamic-card account">
      <div class="account-head">
        <span class="platform-dot steam"></span>
        <h2>Steam</h2>
        {#if steam}
          <span class="connected">Connecté</span>
        {:else}
          <a href="/settings" class="connect">Lier</a>
        {/if}
      </div>
      {#if steam}
        <p class="account-name">{steam.platform_username ?? 'Compte Steam'}</p>
        <p class="account-sub">Dernière synchro · {steam.last_synced_at ? new Date(steam.last_synced_at).toLocaleDateString('fr-FR') : 'jamais'}</p>
      {:else}
        <p class="account-sub">Liez votre compte pour importer vos succès Steam.</p>
      {/if}
    </div>

    <div class="dynamic-card account">
      <div class="account-head">
        <span class="platform-dot psn"></span>
        <h2>PlayStation</h2>
        {#if psn}
          <span class="connected">Connecté</span>
        {:else}
          <a href="/settings" class="connect">Lier</a>
        {/if}
      </div>
      {#if psn}
        <p class="account-name">{psn.platform_username ?? 'Compte PSN'}</p>
        <p class="account-sub">Dernière synchro · {psn.last_synced_at ? new Date(psn.last_synced_at).toLocaleDateString('fr-FR') : 'jamais'}</p>
      {:else}
        <p class="account-sub">Import manuel via PSNProfiles (API PSN non publique).</p>
      {/if}
    </div>
  </section>

  <!-- Vitrine -->
  <section>
    <div class="section-head">
      <h2>Vitrine</h2>
      <p class="section-sub">Tes jeux les plus complétés</p>
    </div>

    {#if showcase.length === 0}
      <div class="empty dynamic-card">
        <p>Aucun jeu complété pour l'instant. Ta vitrine se remplira au fil des succès.</p>
        <a href="/games" class="btn-ghost">Explorer la bibliothèque</a>
      </div>
    {:else}
      <div class="showcase">
        {#each showcase as game (game.id)}
          <a href="/games/{game.slug}" class="dynamic-card show-card">
            {#if game.cover_url}
              <img src={game.cover_url} alt={game.name} />
            {:else}
              <div class="show-fallback">🏆</div>
            {/if}
            <div class="show-overlay">
              <p class="show-name">{game.name}</p>
              <div class="show-progress">
                <span class="mono">{Math.round(game.user_progress?.completion_percentage ?? 0)}%</span>
                <div class="bar"><i style="width: {Math.min(100, game.user_progress?.completion_percentage ?? 0)}%"></i></div>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  /* Hero */
  .profile-hero {
    position: relative;
    border-radius: 1.25rem;
    border: 1px solid hsl(var(--border) / 80%);
    background: linear-gradient(180deg, hsl(var(--card)), hsl(var(--card) / 60%));
    overflow: hidden;
  }

  .banner {
    position: relative;
    height: 7.5rem;
    background:
      radial-gradient(120% 140% at 15% 0%, hsl(15 92% 56% / 35%), transparent 55%),
      radial-gradient(120% 160% at 85% 10%, hsl(42 95% 55% / 25%), transparent 55%),
      linear-gradient(135deg, hsl(var(--secondary)), hsl(var(--background)));
  }

  .banner-glow {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(hsl(var(--primary) / 15%) 1px, transparent 1px);
    background-size: 14px 14px;
    opacity: 0.5;
  }

  .identity {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 1rem;
    padding: 0 1.5rem 1.5rem;
    margin-top: -3rem;
  }

  .avatar {
    position: relative;
    width: 6.5rem;
    height: 6.5rem;
    border-radius: 1.5rem;
    border: 4px solid hsl(var(--card));
    background: linear-gradient(135deg, hsl(var(--secondary)), hsl(var(--muted)));
    display: grid;
    place-items: center;
    font-size: 2.5rem;
    font-weight: 800;
    color: hsl(var(--muted-foreground));
    box-shadow: 0 18px 40px -16px rgb(0 0 0 / 70%);
    overflow: hidden;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .status-dot {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 9999px;
    border: 2px solid hsl(var(--card));
    background: hsl(var(--muted-foreground));
  }

  .status-dot.online {
    background: hsl(142 71% 45%);
  }

  .who {
    flex: 1;
    min-width: 12rem;
    padding-bottom: 0.25rem;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .name-row h1 {
    font-size: clamp(1.5rem, 3vw, 1.9rem);
    font-weight: 800;
    letter-spacing: -0.03em;
  }

  .verified-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    border: 1px solid hsl(var(--primary) / 30%);
    border-radius: 9999px;
    background: hsl(var(--primary) / 10%);
    font-size: 0.6875rem;
    font-weight: 700;
    color: hsl(var(--primary));
  }

  .verified-pill svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  .verified-pill.local {
    border-color: hsl(var(--border));
    background: hsl(var(--secondary));
    color: hsl(var(--muted-foreground));
  }

  .tagline {
    margin-top: 0.15rem;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }

  .btn-ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.25rem;
    padding: 0 0.9rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
    transition: all 0.15s ease;
  }

  .btn-ghost:hover {
    border-color: hsl(var(--primary) / 40%);
    color: hsl(var(--foreground));
  }

  .btn-ghost svg {
    width: 0.9rem;
    height: 0.9rem;
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
    padding: 1rem;
  }

  .label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: hsl(var(--muted-foreground));
  }

  .value {
    margin-top: 0.35rem;
    font-size: 1.7rem;
  }

  /* Comptes */
  .accounts {
    display: grid;
    gap: 0.75rem;
  }

  @media (min-width: 768px) {
    .accounts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .account {
    padding: 1.1rem;
  }

  .account-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .platform-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 9999px;
  }

  .platform-dot.steam {
    background: hsl(214 100% 60%);
  }

  .platform-dot.psn {
    background: hsl(340 83% 65%);
  }

  .account-head h2 {
    font-size: 0.9375rem;
    font-weight: 700;
  }

  .connected,
  .connect {
    margin-left: auto;
    padding: 0.15rem 0.55rem;
    border-radius: 9999px;
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .connected {
    background: hsl(142 71% 45% / 12%);
    color: hsl(142 71% 55%);
  }

  .connect {
    border: 1px solid hsl(var(--primary) / 30%);
    color: hsl(var(--primary));
  }

  .account-name {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .account-sub {
    margin-top: 0.15rem;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  /* Vitrine */
  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .section-head h2 {
    font-size: 1.125rem;
    font-weight: 700;
  }

  .section-sub {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .showcase {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (min-width: 1024px) {
    .showcase {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .show-card {
    position: relative;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    padding: 0;
  }

  .show-card img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.4s ease;
  }

  .show-card:hover img {
    transform: scale(1.05);
  }

  .show-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, hsl(var(--secondary)), hsl(var(--muted)));
    font-size: 1.5rem;
  }

  .show-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 0.75rem;
    background: linear-gradient(180deg, transparent 40%, rgb(0 0 0 / 80%));
  }

  .show-name {
    font-size: 0.8125rem;
    font-weight: 700;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .show-progress {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.625rem;
    color: hsl(45 95% 65%);
  }

  .bar {
    flex: 1;
    height: 0.25rem;
    border-radius: 9999px;
    background: rgb(255 255 255 / 20%);
    overflow: hidden;
  }

  .bar i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, hsl(15 92% 56%), hsl(42 95% 55%));
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 1rem;
    text-align: center;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }
</style>
