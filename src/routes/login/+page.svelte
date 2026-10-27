<script lang="ts">
  import { goto } from '$app/navigation';
  import { tauriApi, type SteamResolvedProfile } from '@/lib/tauri';
  import { toast } from '@/lib/stores/toast';

  let query = $state('');
  let lastSearched = $state('');
  let resolution = $state<SteamResolvedProfile | null>(null);
  let searching = $state(false);
  let linking = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (searchTimer) clearTimeout(searchTimer);
    const trimmed = query.trim();
    if (!trimmed || linking) {
      resolution = null;
      searching = false;
      return;
    }
    searching = true;
    searchTimer = setTimeout(async () => {
      if (lastSearched === trimmed) {
        searching = false;
        return;
      }
      lastSearched = trimmed;
      try {
        resolution = await tauriApi.steamResolveVanity(trimmed);
      } catch {
        resolution = null;
      } finally {
        searching = false;
      }
    }, 400);
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });

  const resultShown = $derived(
    !linking && !searching && query.trim() && lastSearched === query.trim(),
  );

  async function handleLink(profile: SteamResolvedProfile) {
    linking = true;
    try {
      await tauriApi.authenticateSteam({ steam_id: profile.steamid });
      toast.success('Compte Steam lié');
      goto('/');
    } catch (error) {
      toast.error('Échec de la liaison Steam', error instanceof Error ? error.message : String(error));
    } finally {
      linking = false;
    }
  }
</script>

<svelte:head><title>Project Achievers — Connexion</title></svelte:head>

<div class="page">
  <div class="ambient -top-40 partial"></div>
  <div class="ambient -bottom-48 -right-32"></div>

  <div class="card dynamic-card">
    <!-- En-tête carte -->
    <div class="head">
      <div class="brandline">
        <div class="btn-glossy">🎮</div>
        <h1>
          Project <span class="stat-numeral">Achievers</span>
        </h1>
      </div>
      <h2>Lier un compte Steam</h2>
      <p class="subtitle">
        Tapez votre pseudo Steam : votre profil apparaît ci-dessous, cliquez dessus pour le lier.
      </p>
    </div>

    <!-- Recherche + résultat -->
    <div class="content">
      <div class="searchzone">
        <svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          type="search"
          placeholder="Votre pseudo Steam…"
          bind:value={query}
          disabled={linking} />
      </div>

      {#if resolution && resultShown && !linking}
        <div
          class="profile dynamic-card"
          onclick={() => handleLink(resolution!)}
          onkeydown={(e) => e.key === 'Enter' && handleLink(resolution!)}
          role="button"
          tabindex="0"
        >
          <img src={resolution.avatar} alt={resolution.personaname} />
          <div class="profile-meta">
            <p class="name">{resolution.personaname}</p>
            <p class="steamid">{resolution.steamid}</p>
          </div>
          <span class="linkbtn">
            Lier
          </span>
        </div>
      {:else if searching && !resolution}
        <div class="state">
          <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
          Recherche du profil…
        </div>
      {:else if resultShown && !resolution}
        <div class="state">
          <div class="ico">🎮</div>
          <p>
            Aucun profil Steam trouvé pour <b>{query.trim()}</b>
          </p>
          <p class="hint">Steam exige un pseudo exact (celui de l'URL steamcommunity.com/id/…).</p>
        </div>
      {/if}

      {#if linking}
        <div class="state">
          <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
          Liaison du compte…
        </div>
      {/if}

      <div class="eyebrow-mini">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" /></svg>
        PlayStation · import manuel PSNProfiles à venir
      </div>
    </div>

    <!-- Footer -->
    <div class="foot">
      <p class="noaccount">
        Pas de compte Steam ? Vous pouvez utiliser l'application sans lier de compte.
      </p>
      <a href="/" class="outline">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 13c0 5-3.5 7.5-8 7.5S4 18 4 13c0-2.5 1.5-4.5 3-6M12 3v10m0 0 4-4m-4 4-4-4" /></svg>
        Continuer sans compte
      </a>
    </div>
  </div>

  <p class="note">
    Note PlayStation :<i>
      L'API PSN n'est pas publiquement disponible. L'intégration PSN nécessitera une clé API
      officielle ou l'import manuel depuis PSNProfiles.com.</i>
  </p>
</div>

<style>
  .page {
    position: relative;
    display: flex;
    min-height: 100vh;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 1rem;
  }

  .ambient {
    pointer-events: none;
    position: absolute;
    border-radius: 50%;
    filter: blur(64px);
    opacity: 0.6;
    background: radial-gradient(closest-side, hsl(var(--primary) / 18%), transparent 70%);
  }

  .ambient.partial {
    left: 50%;
    transform: translateX(-50%);
  }

  .card {
    width: 100%;
    max-width: 28rem;
    padding: 0;
  }

  .head {
    padding: 1.5rem 1.5rem 0;
    text-align: center;
  }

  .brandline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .brandline .btn-glossy {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    font-size: 1.25rem;
    background: hsl(var(--primary));
    border-radius: 0.75rem;
  }

  .brandline h1 {
    font-size: 1.5rem;
    font-weight: 800;
    letter-spacing: -0.03em;
  }

  .head h2 {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .subtitle {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 1.5rem;
  }

  .searchzone {
    position: relative;
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

  .searchzone input {
    width: 100%;
    padding: 0.75rem 1rem 0.75rem 2.5rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border) / 70%);
    background: hsl(var(--secondary) / 50%);
    color: hsl(var(--foreground));
    font-size: 0.875rem;
  }

  .searchzone input:focus {
    outline: none;
    border-color: hsl(var(--primary) / 40%);
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    cursor: pointer;
  }

  .profile img {
    height: 2.75rem;
    width: 2.75rem;
    border-radius: 9999px;
    object-fit: cover;
  }

  .profile-meta {
    min-width: 0;
    flex: 1;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .steamid {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .linkbtn {
    padding: 0.25rem 0.75rem;
    border: 1px solid hsl(var(--primary) / 30%);
    border-radius: 9999px;
    background: hsl(var(--primary) / 10%);
    font-size: 0.6875rem;
    font-weight: 600;
    color: hsl(var(--primary));
  }

  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.25rem 1rem;
    text-align: center;
    border: 1px solid hsl(var(--border) / 60%);
    border-radius: 0.75rem;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .state .ico {
    font-size: 1.5rem;
    opacity: 0.3;
  }

  .state b {
    font-weight: 600;
    color: hsl(var(--foreground));
  }

  .state .hint {
    font-size: 0.6875rem;
    opacity: 0.7;
  }

  .spin {
    width: 0.9rem;
    height: 0.9rem;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .eyebrow-mini {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding-top: 0.25rem;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: hsl(var(--accent));
  }

  .eyebrow-mini svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  .foot {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0 1.5rem 1.5rem;
  }

  .noaccount {
    text-align: center;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .foot a {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    height: 2.5rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: hsl(var(--foreground));
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .foot a:hover {
    border-color: hsl(var(--primary) / 40%);
  }

  .foot a svg {
    width: 1rem;
    height: 1rem;
  }

  .note {
    margin-top: 2rem;
    max-width: 28rem;
    text-align: center;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }

  .note i {
    font-style: italic;
  }
</style>
