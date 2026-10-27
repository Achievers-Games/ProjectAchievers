<script lang="ts">
  import { onMount } from 'svelte';
  import { tauriApi, type FeedItem, type LeaderboardEntry } from '@/lib/tauri';
  import { formatRelativeDate } from '@/lib/utils';

  let feed = $state<FeedItem[] | null>(null);
  let leaderboard = $state<LeaderboardEntry[] | null>(null);

  onMount(async () => {
    try {
      const [f, l] = await Promise.all([
        tauriApi.getCommunityFeed(24),
        tauriApi.getLeaderboard(10),
      ]);
      feed = f;
      leaderboard = l;
    } catch {
      feed = [];
      leaderboard = [];
    }
  });

  function trophyColor(type: string | null): string {
    switch (type) {
      case 'platinum': return 'platinum';
      case 'gold': return 'gold';
      case 'silver': return 'silver';
      case 'bronze': return 'bronze';
      default: return 'plain';
    }
  }
</script>

<svelte:head><title>Communauté — Project Achievers</title></svelte:head>

<div class="page">
  <!-- Hero -->
  <section class="hero">
    <div class="hero-glow-a"></div>
    <div class="hero-glow-b"></div>
    <div class="hero-inner">
      <div>
        <p class="season">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" /></svg>
          Saison · Automne 2026
        </p>
        <h1>Le QG des <span class="stat-numeral">chasseurs</span></h1>
        <p class="sub">
          Suis les derniers succès débloqués par la communauté, découvre les profils qui font
          trembler les classements et partage tes propres exploits.
        </p>
      </div>
      <div class="hero-actions">
        <a href="/games" class="btn-glossy">Explorer la bibliothèque</a>
        <a href="/profile" class="btn-ghost">Ma vitrine</a>
      </div>
    </div>
  </section>

  <div class="layout">
    <!-- Flux -->
    <section class="feed-col">
      <div class="feed-head">
        <div>
          <h2>En direct</h2>
          <p class="feed-sub">Derniers succès débloqués</p>
        </div>
        <span class="live">
          <i></i>
          LIVE
        </span>
      </div>

      {#if feed === null}
        <div class="feed-list">
          {#each { length: 5 } as _, i (i)}
            <div class="skeleton-item">
              <div class="sk-avatar"></div>
              <div class="sk-lines">
                <div class="sk-line w-60"></div>
                <div class="sk-line w-40"></div>
              </div>
            </div>
          {/each}
        </div>
      {:else if feed.length === 0}
        <div class="empty dynamic-card">
          <div class="empty-ico">🏆</div>
          <h3>Aucune activité pour l'instant</h3>
          <p>Liez un compte Steam puis synchronisez pour voir apparaître vos succès ici.</p>
          <a href="/settings" class="btn-glossy">Lier un compte</a>
        </div>
      {:else}
        <div class="feed-list">
          {#each feed as item (item.id)}
            <article class="feed-card dynamic-card reveal">
              <div class="feed-left">
                <div class="avatar">
                  {#if item.avatar_url}
                    <img src={item.avatar_url} alt={item.username} />
                  {:else}
                    <span>{item.username.charAt(0).toUpperCase()}</span>
                  {/if}
                  {#if item.achievement_icon_url}
                    <img class="ach-icon" src={item.achievement_icon_url} alt={item.achievement_name} />
                  {/if}
                </div>
              </div>
              <div class="feed-body">
                <p class="feed-text">
                  <b>{item.username}</b>
                  <span class="muted"> a débloqué </span>
                  <a class="ach-link" href="/achievements/{item.achievement_id}">
                    <b class="ach-name">{item.achievement_name}</b>
                  </a>
                </p>
                <a class="game-link" href="/games/{item.game_slug}">
                  {#if item.game_cover_url}
                    <img src={item.game_cover_url} alt={item.game_name} />
                  {/if}
                  <span>{item.game_name}</span>
                </a>
                <div class="feed-meta">
                  {#if item.trophy_type}
                    <span class="trophy {trophyColor(item.trophy_type)}">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M8.2 6h7.6M6 4h12v11a12 12 0 0 1-12 0z" /></svg>
                      {item.trophy_type}
                    </span>
                  {/if}
                  {#if item.rarity != null}
                    <span class="mono">{item.rarity.toFixed(1)} % des joueurs</span>
                  {/if}
                  <span class="mono time">{formatRelativeDate(item.unlocked_at)}</span>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Rail droit -->
    <aside class="rail">
      <section class="dynamic-card rail-card">
        <div class="rail-head">
          <h2>Classement</h2>
          <span class="rail-sub">Points & platinums</span>
        </div>

        {#if leaderboard === null}
          <div class="leader-skeleton">
            {#each { length: 5 } as _, i (i)}
              <div class="sk-line w-full"></div>
            {/each}
          </div>
        {:else if leaderboard.length === 0}
          <p class="rail-empty">Le classement se remplira dès les premiers succès synchronisés.</p>
        {:else}
          <ol class="leaderlist">
            {#each leaderboard as entry, i (entry.username)}
              <li class="leaderrow" class:top={i < 3}>
                <span class="rank">{i + 1}</span>
                <div class="leader-avatar">
                  {#if entry.avatar_url}
                    <img src={entry.avatar_url} alt={entry.username} />
                  {:else}
                    <span>{entry.username.charAt(0).toUpperCase()}</span>
                  {/if}
                </div>
                <div class="leader-name">
                  <p>{entry.username}</p>
                  <span>{entry.platinums} platine{entry.platinums > 1 ? 's' : ''}</span>
                </div>
                <span class="leader-points">{entry.points}</span>
              </li>
            {/each}
          </ol>
        {/if}
      </section>

      <section class="dynamic-card rail-card cta-card">
        <div class="cta-glow"></div>
        <h2>Partage ton savoir</h2>
        <p>
          Rédige des guides, aide les autres chasseurs et gagne la confiance de la communauté.
        </p>
        <a href="/games" class="btn-ghost">Choisir un jeu</a>
      </section>
    </aside>
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  /* Hero */
  .hero {
    position: relative;
    overflow: hidden;
    border-radius: 1.25rem;
    border: 1px solid hsl(var(--border) / 80%);
    background: linear-gradient(180deg, hsl(var(--card)), hsl(var(--card) / 60%));
  }

  .hero-glow-a {
    pointer-events: none;
    position: absolute;
    top: -7rem;
    left: -5rem;
    width: 18rem;
    height: 18rem;
    border-radius: 50%;
    background: radial-gradient(closest-side, hsl(15 92% 56% / 25%), transparent);
  }

  .hero-glow-b {
    pointer-events: none;
    position: absolute;
    bottom: -9rem;
    right: -2rem;
    width: 18rem;
    height: 18rem;
    border-radius: 50%;
    background: radial-gradient(closest-side, hsl(42 95% 55% / 18%), transparent);
  }

  .hero-inner {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
  }

  @media (min-width: 1024px) {
    .hero-inner {
      flex-direction: row;
      align-items: flex-end;
      justify-content: space-between;
      padding: 2rem;
    }
  }

  .season {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
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

  .season svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  h1 {
    font-size: clamp(1.8rem, 4.2vw, 2.6rem);
    font-weight: 800;
    letter-spacing: -0.035em;
  }

  .sub {
    max-width: 38rem;
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .btn-glossy,
  .btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2.4rem;
    padding: 0 1rem;
    border-radius: 9999px;
    font-size: 0.8125rem;
    font-weight: 600;
    text-decoration: none;
  }

  .btn-glossy {
    background: hsl(var(--primary));
    border: none;
    color: hsl(var(--primary-foreground));
    box-shadow: 0 8px 24px -8px hsl(var(--primary) / 60%);
  }

  .btn-ghost {
    border: 1px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
  }

  .btn-ghost:hover {
    border-color: hsl(var(--primary) / 40%);
    color: hsl(var(--foreground));
  }

  /* Layout */
  .layout {
    display: grid;
    gap: 1.25rem;
    grid-template-columns: 1fr;
  }

  @media (min-width: 1024px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 20rem;
      align-items: start;
    }
  }

  /* Feed */
  .feed-col {
    min-width: 0;
  }

  .feed-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .feed-head h2 {
    font-size: 1.125rem;
    font-weight: 700;
  }

  .feed-sub {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .live {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.55rem;
    border: 1px solid hsl(0 84% 60% / 30%);
    border-radius: 9999px;
    background: hsl(0 84% 60% / 10%);
    font-size: 0.625rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: hsl(0 84% 65%);
  }

  .live i {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 9999px;
    background: hsl(0 84% 60%);
    animation: blink 1.4s ease-in-out infinite;
  }

  @keyframes blink {
    50% { opacity: 0.25; }
  }

  .feed-list {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .feed-card {
    display: flex;
    gap: 0.8rem;
    padding: 0.9rem;
  }

  .avatar {
    position: relative;
    width: 2.9rem;
    height: 2.9rem;
    border-radius: 9999px;
    overflow: visible;
    background: hsl(var(--secondary));
    display: grid;
    place-items: center;
    font-weight: 700;
    color: hsl(var(--muted-foreground));
  }

  .avatar > img:first-child {
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    object-fit: cover;
  }

  .ach-icon {
    position: absolute;
    right: -0.35rem;
    bottom: -0.35rem;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 0.4rem;
    border: 2px solid hsl(var(--card));
    object-fit: cover;
    background: hsl(var(--secondary));
  }

  .feed-body {
    flex: 1;
    min-width: 0;
  }

  .feed-text {
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .muted {
    color: hsl(var(--muted-foreground));
  }

  .ach-name {
    color: hsl(var(--accent));
  }

  .ach-link:hover .ach-name {
    text-decoration: underline;
  }

  .game-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.4rem;
    padding: 0.15rem 0.5rem 0.15rem 0.15rem;
    border: 1px solid hsl(var(--border) / 70%);
    border-radius: 9999px;
    background: hsl(var(--secondary) / 40%);
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
    max-width: 100%;
  }

  .game-link:hover {
    border-color: hsl(var(--primary) / 40%);
    color: hsl(var(--foreground));
  }

  .game-link img {
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 0.3rem;
    object-fit: cover;
  }

  .game-link span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }

  .trophy {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.05rem 0.4rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border));
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: capitalize;
    color: hsl(var(--muted-foreground));
  }

  .trophy svg {
    width: 0.65rem;
    height: 0.65rem;
  }

  .trophy.platinum {
    color: hsl(203 89% 75%);
    border-color: hsl(203 89% 60% / 40%);
    background: hsl(203 89% 60% / 10%);
  }

  .trophy.gold {
    color: hsl(45 95% 65%);
    border-color: hsl(45 95% 55% / 40%);
    background: hsl(45 95% 55% / 10%);
  }

  .trophy.silver {
    color: hsl(210 12% 75%);
    border-color: hsl(210 12% 68% / 40%);
    background: hsl(210 12% 68% / 10%);
  }

  .trophy.bronze {
    color: hsl(20 83% 65%);
    border-color: hsl(20 83% 55% / 40%);
    background: hsl(20 83% 55% / 10%);
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.625rem;
    color: hsl(var(--muted-foreground));
  }

  .time {
    margin-left: auto;
  }

  /* Skeletons */
  .skeleton-item {
    display: flex;
    gap: 0.8rem;
    padding: 0.9rem;
    border-radius: 1rem;
    border: 1px solid hsl(var(--border) / 60%);
  }

  .sk-avatar {
    width: 2.9rem;
    height: 2.9rem;
    border-radius: 9999px;
    background: hsl(var(--secondary));
    animation: pulse 1.5s ease-in-out infinite;
  }

  .sk-lines {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    justify-content: center;
  }

  .sk-line {
    height: 0.55rem;
    border-radius: 9999px;
    background: hsl(var(--secondary));
    animation: pulse 1.5s ease-in-out infinite;
  }

  .w-60 { width: 60%; }
  .w-40 { width: 40%; }
  .w-full { width: 100%; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Rail */
  .rail {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .rail-card {
    padding: 1rem;
  }

  .rail-head {
    margin-bottom: 0.75rem;
  }

  .rail-head h2 {
    font-size: 1rem;
    font-weight: 700;
  }

  .rail-sub {
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .leaderlist {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .leaderrow {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.35rem;
    border-radius: 0.65rem;
  }

  .leaderrow.top {
    background: hsl(var(--secondary) / 35%);
  }

  .rank {
    width: 1.1rem;
    text-align: center;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    color: hsl(var(--muted-foreground));
  }

  .leaderrow.top:first-child .rank {
    color: hsl(45 95% 60%);
    font-weight: 700;
  }

  .leader-avatar {
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 9999px;
    overflow: hidden;
    background: hsl(var(--secondary));
    display: grid;
    place-items: center;
    font-size: 0.7rem;
    font-weight: 700;
    color: hsl(var(--muted-foreground));
  }

  .leader-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .leader-name {
    flex: 1;
    min-width: 0;
  }

  .leader-name p {
    font-size: 0.78rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .leader-name span {
    font-size: 0.625rem;
    color: hsl(var(--muted-foreground));
  }

  .leader-points {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 600;
    color: hsl(var(--accent));
  }

  .rail-empty {
    font-size: 0.72rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.5;
  }

  .leader-skeleton {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* CTA */
  .cta-card {
    position: relative;
    overflow: hidden;
  }

  .cta-glow {
    position: absolute;
    top: -3rem;
    right: -2rem;
    width: 8rem;
    height: 8rem;
    border-radius: 50%;
    background: radial-gradient(closest-side, hsl(15 92% 56% / 25%), transparent);
    pointer-events: none;
  }

  .cta-card h2 {
    font-size: 1rem;
    font-weight: 700;
  }

  .cta-card p {
    margin-top: 0.35rem;
    font-size: 0.75rem;
    line-height: 1.55;
    color: hsl(var(--muted-foreground));
  }

  .cta-card .btn-ghost {
    margin-top: 0.75rem;
    height: 2rem;
    font-size: 0.72rem;
  }

  /* Empty */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2.5rem 1rem;
    text-align: center;
  }

  .empty-ico {
    font-size: 1.8rem;
    opacity: 0.5;
  }

  .empty h3 {
    font-size: 0.95rem;
    font-weight: 700;
  }

  .empty p {
    max-width: 22rem;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .empty .btn-glossy {
    margin-top: 0.4rem;
    height: 2.1rem;
    font-size: 0.75rem;
  }
</style>
