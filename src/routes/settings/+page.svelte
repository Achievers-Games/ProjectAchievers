<script lang="ts">
  import { onMount } from 'svelte';
  import { tauriApi, runOAuth, type AuthStatus, type AuthStatus_Serialize, type LinkedAccount_Serialize, type AppVersion, type SteamResolvedProfile, type SessionInfo } from '@/lib/tauri';
  import { toast } from '@/lib/stores/toast';
  import { theme, setTheme } from '@/lib/stores/theme';
  import { auth as authStore } from '@/lib/stores/auth';

  let auth = $state<AuthStatus | null>(null);
  let appVersion = $state<AppVersion | null>(null);
  let query = $state('');
  let lastSearched = $state('');
  let candidate = $state<SteamResolvedProfile | null>(null);
  let searching = $state(false);
  let linking = $state(false);
  let unlinking = $state(false);
  let syncing = $state(false);
  let oauthLoading = $state<'steam' | 'discord' | null>(null);
  let psnLoading = $state(false);
  let psnInput = $state('');
  let sessionsLoading = $state(false);
  let sessions = $state<SessionInfo[]>([]);
  let currentSessionId = $state<string | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    void loadAuth();
    void loadSessions();
    void checkOAuthRedirect();
    void tauriApi
      .getAppVersion()
      .then((version) => (appVersion = version))
      .catch(() => (appVersion = null));
  });

  /**
   * Check URL query params for OAuth redirect results.
   * The backend redirects back here with ?steam_connected=true or ?discord_connected=true
   * (or ?error=... on failure).
   */
  async function checkOAuthRedirect() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('steam_connected')) {
      toast.success('Compte Steam lié', 'Connexion réussie.');
      // Clear the query param from URL
      window.history.replaceState({}, document.title, '/settings');
      await authStore.createSession();
      await loadAuth();
    }

    if (params.has('discord_connected')) {
      toast.success('Compte Discord lié', 'Connexion réussie.');
      window.history.replaceState({}, document.title, '/settings');
      await authStore.createSession();
      await loadAuth();
    }

    const error = params.get('error');
    if (error) {
      const errorMsg =
        error === 'steam_auth_failed'
          ? 'Échec de l\'authentification Steam.'
          : error === 'discord_auth_failed'
            ? 'Échec de l\'authentification Discord.'
            : error;
      toast.error('Connexion échouée', errorMsg);
      window.history.replaceState({}, document.title, '/settings');
    }
  }

  async function loadAuth() {
    try {
      auth = await tauriApi.getAuthStatus();
    } catch {
      auth = null;
    }
  }

  $effect(() => {
    if (searchTimer) clearTimeout(searchTimer);
    const trimmed = query.trim();
    if (!trimmed || linking) {
      candidate = null;
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
        candidate = await tauriApi.steamResolveVanity(trimmed);
      } catch {
        candidate = null;
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
  const steam = $derived(auth?.linked_accounts.find((a) => a.platform === 'steam'));
  const psn = $derived(auth?.linked_accounts.find((a) => a.platform === 'psn'));
  const discord = $derived(auth?.linked_accounts.find((a) => a.platform === 'discord'));

  function syncLabel(status: string): string {
    switch (status) {
      case 'pending':
        return 'à synchroniser';
      case 'syncing':
        return 'synchronisation…';
      case 'completed':
        return 'synchronisé';
      case 'failed':
        return 'échec de la synchronisation';
      default:
        return status;
    }
  }

  async function handleLink(profile: SteamResolvedProfile) {
    linking = true;
    try {
      await tauriApi.authenticateSteam({ steam_id: profile.steamid });
      toast.success('Compte Steam lié');
      query = '';
      candidate = null;
      await loadAuth();
    } catch (e) {
      toast.error('Échec de la liaison Steam', e instanceof Error ? e.message : String(e));
    } finally {
      linking = false;
    }
  }

  async function handleUnlink(accountId: string) {
    unlinking = true;
    try {
      await tauriApi.unlinkAccount(accountId);
      toast.success('Compte dissocié');
      await loadAuth();
    } catch (e) {
      toast.error('Échec de la dissociation', e instanceof Error ? e.message : String(e));
    } finally {
      unlinking = false;
    }
  }

  async function handleOAuth(provider: 'steam' | 'discord') {
    if (oauthLoading) return;
    oauthLoading = provider;
    try {
      const result = await runOAuth(provider);
      if (!result.success) {
        toast.error(
          provider === 'steam' ? 'Connexion Steam échouée' : 'Connexion Discord échouée',
          result.error,
        );
        return;
      }
      toast.success(provider === 'steam' ? 'Compte Steam lié' : 'Compte Discord lié');
      // Create a JWT session so subsequent requests are authenticated
      await authStore.createSession();
      await loadAuth();
    } catch (e) {
      toast.error(
        provider === 'steam' ? 'Connexion Steam échouée' : 'Connexion Discord échouée',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      oauthLoading = null;
    }
  }

  async function handlePsnLink() {
    if (psnLoading) return;
    if (!psnInput.trim()) {
      toast.error('PSN', 'Le token NPSSO est requis.');
      return;
    }
    psnLoading = true;
    try {
      await tauriApi.authenticatePsn({ npsso: psnInput.trim() });
      toast.success('Compte PSN lié');
      await authStore.createSession();
      psnInput = '';
      await loadAuth();
    } catch (e) {
      toast.error('Échec de la liaison PSN', e instanceof Error ? e.message : String(e));
    } finally {
      psnLoading = false;
    }
  }

  async function loadSessions() {
    sessionsLoading = true;
    try {
      const result = await tauriApi.getSessions();
      sessions = result;
      // Try to get the current session ID from the auth store
      currentSessionId = $authStore.sessionId;
    } catch {
      sessions = [];
    } finally {
      sessionsLoading = false;
    }
  }

  async function handleRevokeSession(sessionId: string, isCurrent: boolean) {
    try {
      if (isCurrent) {
        await tauriApi.revokeSession(sessionId);
        toast.success('Déconnexion du compte');
        // Clear auth store
        await authStore.logout(true);
      } else {
        await tauriApi.revokeSession(sessionId);
        toast.success('Session révoquée');
      }
      await loadSessions();
    } catch (e) {
      toast.error('Échec de la révocation', e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRevokeAll() {
    if (!currentSessionId) return;
    try {
      const count = await tauriApi.revokeOtherSessions(currentSessionId);
      toast.success(
        `${count} session${count > 1 ? 's' : ''} révoquée${count > 1 ? 's' : ''}`,
        'Toutes les autres sessions ont été déconnectées.',
      );
      await loadSessions();
    } catch (e) {
      toast.error('Échec de la déconnexion', e instanceof Error ? e.message : String(e));
    }
  }

  function formatSessionDate(ts: number | null | undefined): string {
    if (!ts) return 'Inconnue';
    const d = new Date(ts);
    // Use a short, locale-aware format
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function handleSync() {
    syncing = true;
    try {
      const result = await tauriApi.syncAllPlatforms();
      await loadAuth();

      const warnings = result.steam.errors.length;
      const gameLabel = result.total_games > 1 ? 'jeux' : 'jeu';
      if (result.total_games === 0 && warnings > 0) {
        toast.error('Synchronisation impossible', result.steam.errors[0]);
      } else if (warnings > 0) {
        toast.success(
          'Synchronisation partielle',
          `${result.total_games} ${gameLabel} · ${result.total_achievements} succès · ${warnings} avertissement${warnings === 1 ? '' : 's'}`,
        );
      } else {
        toast.success(
          'Synchronisation terminée',
          `${result.total_games} ${gameLabel} · ${result.total_achievements} succès importés`,
        );
      }
    } catch (e) {
      await loadAuth();
      toast.error('Échec de la synchronisation', e instanceof Error ? e.message : String(e));
    } finally {
      syncing = false;
    }
  }
</script>

<svelte:head><title>Paramètres — Project Achievers</title></svelte:head>

<div class="page">
  <header>
    <h1>Paramètres</h1>
    <p>Gère tes comptes, ton thème et l'application.</p>
  </header>

  <!-- Comptes liés -->
  <section class="dynamic-card block">
    <div class="block-head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 13c0 5-3.5 7.5-8 7.5S4 18 4 13c0-2.5 1.5-4.5 3-6M12 3v10m0 0 4-4m-4 4-4-4" /></svg>
      <h2>Comptes liés</h2>
    </div>

    <!-- Steam -->
    <div class="account-row">
      <div class="account-info">
        <span class="dot steam"></span>
        <div>
          <p class="name">Steam</p>
          <p class="sub">
            {#if steam}
              {steam.platform_username ?? 'Compte Steam'} · {syncLabel(steam.sync_status)}
            {:else}
              Importe tes succès Steam
            {/if}
          </p>
          {#if steam?.sync_error}
            <p class="sync-error" title={steam.sync_error}>{steam.sync_error}</p>
          {/if}
        </div>
      </div>

      {#if steam}
        <div class="account-actions">
          <button class="btn-outline primary" onclick={handleSync} disabled={syncing || unlinking}>
            {syncing ? 'Synchronisation…' : 'Synchroniser'}
          </button>
          <button
            class="btn-outline"
            onclick={() => handleUnlink(steam.id)}
            disabled={unlinking || syncing}
          >
            {unlinking ? 'Dissociation…' : 'Dissocier'}
          </button>
        </div>
      {:else}
        <div class="link-form">
          <div class="search-mini">
            <input
              type="search"
              placeholder="Pseudo Steam…"
              aria-label="Pseudo Steam à lier"
              bind:value={query}
              disabled={linking}
            />
          </div>
          <p class="search-hint">Pseudo personnalisé, URL Steam ou SteamID64.</p>
          <button
            class="btn-outline oauth-inline"
            onclick={() => handleOAuth('steam')}
            disabled={oauthLoading !== null}
          >
            {oauthLoading === 'steam' ? 'Connexion…' : 'Connexion OAuth Steam'}
          </button>
        </div>
      {/if}
    </div>

    {#if !steam}
      {#if candidate && resultShown}
        <button class="candidate" onclick={() => handleLink(candidate!)} disabled={linking}>
          {#if candidate.avatar}
            <img src={candidate.avatar} alt={candidate.personaname} />
          {/if}
          <span class="cand-name">{candidate.personaname}</span>
          <span class="cand-id">{candidate.steamid}</span>
          <span class="cand-cta">{linking ? 'Liaison…' : 'Lier ce compte'}</span>
        </button>
      {:else if searching}
        <p class="search-state">Recherche du profil…</p>
      {:else if resultShown}
        <p class="search-state">Aucun profil Steam trouvé pour « {query.trim()} ».</p>
      {/if}
    {/if}

    <!-- Discord -->
    <div class="account-row">
      <div class="account-info">
        <span class="dot discord"></span>
        <div>
          <p class="name">Discord</p>
          <p class="sub">
            {discord
              ? (discord.platform_username ?? 'Compte Discord')
              : 'Partage tes succès et retrouve la communauté'}
          </p>
        </div>
      </div>
      {#if discord}
        <div class="account-actions">
          <button
            class="btn-outline"
            onclick={() => handleUnlink(discord.id)}
            disabled={unlinking || oauthLoading !== null}
          >
            {unlinking ? 'Dissociation…' : 'Dissocier'}
          </button>
        </div>
      {:else}
        <button
          class="btn-outline primary"
          onclick={() => handleOAuth('discord')}
          disabled={oauthLoading !== null}
        >
          {oauthLoading === 'discord' ? 'Connexion…' : 'Connecter Discord'}
        </button>
      {/if}
    </div>

    <!-- PSN -->
    <div class="account-row">
      <div class="account-info">
        <span class="dot psn"></span>
        <div>
          <p class="name">PlayStation Network</p>
          <p class="sub">
            {psn ? (psn.platform_username ?? 'Compte PSN') : 'Import manuel via token NPSSO'}
          </p>
        </div>
      </div>
      {#if psn}
        <div class="account-actions">
          <button class="btn-outline" onclick={() => handleUnlink(psn.id)} disabled={unlinking}>
            {unlinking ? 'Dissociation…' : 'Dissocier'}
          </button>
        </div>
      {:else}
        <div class="link-form psn-form">
          <input
            type="text"
            placeholder="Token NPSSO"
            aria-label="Token NPSSO PSN"
            bind:value={psnInput}
            disabled={psnLoading}
            class="psn-input"
          />
          <button
            class="btn-outline primary psn-link-btn"
            onclick={handlePsnLink}
            disabled={psnLoading || !psnInput.trim()}
          >
            {psnLoading ? 'Connexion…' : 'Lier'}
          </button>
        </div>
      {/if}
    </div>
  </section>

  <!-- Apparence -->
  <section class="dynamic-card block">
    <div class="block-head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
      <h2>Apparence</h2>
    </div>

    <div class="theme-row">
      <div>
        <p class="name">Thème</p>
        <p class="sub">Sombre (Kyara) ou clair</p>
      </div>
      <div class="segmented">
        <button class:active={$theme === 'dark'} onclick={() => setTheme('dark')}>Sombre</button>
        <button class:active={$theme === 'light'} onclick={() => setTheme('light')}>Clair</button>
      </div>
    </div>
  </section>

  <!-- À propos -->
  <section class="dynamic-card block">
    <div class="block-head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
      <h2>À propos</h2>
    </div>
    <p class="about">
      <b>Project Achievers</b> v{appVersion?.version ?? '0.1.0'} — la communauté des chasseurs de
      succès. Suis tes jeux, partage tes guides et compare ta collection.
    </p>
    <p class="local-note">Tes données restent stockées sur cet appareil.</p>
  </section>

  <!-- Sessions actives -->
  <section class="dynamic-card block">
    <div class="block-head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
      <h2>Sessions actives</h2>
    </div>
    {#if sessionsLoading}
      <p class="sync-state">Chargement des sessions…</p>
    {:else if sessions.length === 0}
      <p class="sync-state">Aucune session active.</p>
    {:else}
      <ul class="session-list">
        {#each sessions as session (session.session_id)}
          {@const isCurrent = session.session_id === currentSessionId}
          <li class="session-item">
            <div class="session-info">
              <div class="session-name">
                {isCurrent ? 'Cette session' : session.user_agent ?? 'Session inconnue'}
              </div>
              <div class="session-meta">
                Créée le {formatSessionDate(session.created_at)}
                {#if session.last_used_at}
                  · Dernière activité : {formatSessionDate(session.last_used_at)}
                {/if}
                · Expire le {formatSessionDate(session.expires_at)}
              </div>
            </div>
            <div class="session-actions">
              {#if isCurrent}
                <span class="badge-current">Active</span>
                <button
                  class="btn-outline danger"
                  onclick={() => handleRevokeSession(session.session_id, true)}
                >
                  Se déconnecter
                </button>
              {:else}
                <button
                  class="btn-outline danger"
                  onclick={() => handleRevokeSession(session.session_id, false)}
                >
                  Révoquer
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      {#if sessions.length > 1}
        <button class="btn-outline danger revoke-all" onclick={handleRevokeAll}>
          Déconnecter toutes les autres sessions
        </button>
      {/if}
    {/if}
  </section>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 46rem;
  }

  header h1 {
    font-size: clamp(1.6rem, 3.5vw, 2rem);
    font-weight: 800;
    letter-spacing: -0.03em;
  }

  header p {
    margin-top: 0.2rem;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }

  .block {
    padding: 1.25rem;
  }

  .block-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .block-head svg {
    width: 1.05rem;
    height: 1.05rem;
    color: hsl(var(--primary));
  }

  .block-head h2 {
    font-size: 1rem;
    font-weight: 700;
  }

  .account-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 0;
    border-top: 1px solid hsl(var(--border) / 60%);
  }

  .account-row:first-of-type {
    border-top: none;
  }

  .account-info {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 12rem;
  }

  .dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 9999px;
    flex-shrink: 0;
  }

  .dot.steam {
    background: hsl(214 100% 60%);
    box-shadow: 0 0 12px hsl(214 100% 60% / 60%);
  }

  .dot.psn {
    background: hsl(340 83% 65%);
    box-shadow: 0 0 12px hsl(340 83% 65% / 60%);
  }

  .dot.discord {
    background: hsl(235 86% 65%);
    box-shadow: 0 0 12px hsl(235 86% 65% / 60%);
  }

  .oauth-inline {
    margin: 0.6rem 0 0 0.9rem;
  }

  .name {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .sub {
    font-size: 0.72rem;
    color: hsl(var(--muted-foreground));
  }

  .sync-error {
    max-width: 28rem;
    margin-top: 0.2rem;
    overflow: hidden;
    font-size: 0.68rem;
    color: hsl(0 84% 67%);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-outline {
    height: 2.1rem;
    padding: 0 0.85rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    background: transparent;
    font-size: 0.75rem;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }

  .account-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .btn-outline.primary {
    border-color: hsl(var(--primary) / 40%);
    background: hsl(var(--primary) / 12%);
    color: hsl(var(--primary));
  }

  .btn-outline:hover:not(:disabled) {
    border-color: hsl(var(--primary) / 40%);
    color: hsl(var(--foreground));
  }

  .btn-outline:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .search-state {
    margin: 0.35rem 0 0.75rem;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .link-form {
    flex: 1;
    max-width: 18rem;
  }

  .psn-form {
    gap: 0.4rem;
  }

  .psn-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border) / 70%);
    background: hsl(var(--secondary) / 50%);
    color: hsl(var(--foreground));
    font-size: 0.8125rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .psn-link-btn {
    flex-shrink: 0;
  }

  .search-mini input {
    width: 100%;
    padding: 0.5rem 0.9rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border) / 70%);
    background: hsl(var(--secondary) / 50%);
    color: hsl(var(--foreground));
    font-size: 0.8125rem;
  }

  .search-mini input:focus {
    outline: none;
    border-color: hsl(var(--primary) / 40%);
  }

  .search-hint {
    margin: 0.35rem 0 0 0.9rem;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground) / 80%);
  }

  .candidate {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    margin-top: 0.4rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid hsl(var(--border));
    border-radius: 0.75rem;
    background: hsl(var(--secondary) / 40%);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s ease;
  }

  .candidate:hover {
    border-color: hsl(var(--primary) / 40%);
  }

  .candidate img {
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    object-fit: cover;
  }

  .cand-name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: hsl(var(--foreground));
  }

  .cand-id {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.625rem;
    color: hsl(var(--muted-foreground));
  }

  .cand-cta {
    margin-left: auto;
    font-size: 0.7rem;
    font-weight: 700;
    color: hsl(var(--primary));
  }

  .search-state {
    margin: 0.35rem 0 0.75rem;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .theme-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.25rem;
  }

  .segmented {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.2rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    background: hsl(var(--secondary) / 50%);
  }

  .segmented button {
    padding: 0.35rem 0.8rem;
    border: none;
    border-radius: 9999px;
    background: transparent;
    font-size: 0.75rem;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
  }

  .segmented button.active {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }

  .about {
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.6;
  }

  .about b {
    color: hsl(var(--foreground));
  }

  .local-note {
    margin-top: 0.6rem;
    font-size: 0.72rem;
    color: hsl(var(--muted-foreground) / 80%);
  }

  .session-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .session-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 0.9rem;
    border: 1px solid hsl(var(--border) / 60%);
    border-radius: 0.75rem;
    background: hsl(var(--secondary) / 30%);
  }

  .session-info {
    flex: 1;
  }

  .session-name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: hsl(var(--foreground));
  }

  .session-meta {
    margin-top: 0.25rem;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .session-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .badge-current {
    padding: 0.15rem 0.55rem;
    border-radius: 9999px;
    background: hsl(142 71% 45% / 12%);
    color: hsl(142 71% 55%);
    font-size: 0.65rem;
    font-weight: 600;
  }

  .btn-outline.danger {
    border-color: hsl(0 60% 70% / 40%);
    color: hsl(0 60% 70%);
  }

  .btn-outline.danger:hover:not(:disabled) {
    border-color: hsl(0 60% 70%);
    color: hsl(0 0% 100%);
  }

  .revoke-all {
    margin-top: 0.75rem;
    width: 100%;
  }

  .sync-state {
    margin: 0.5rem 0;
    font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
  }
</style>
