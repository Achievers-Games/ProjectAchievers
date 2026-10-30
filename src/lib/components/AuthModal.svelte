<script lang="ts">
  import { auth as authStore } from '@/lib/stores/auth';
  import { closeAuthModal } from '@/lib/stores/authModal';
  import { tauriApi, runOAuth } from '@/lib/tauri';
  import { toast } from '@/lib/stores/toast';
  import OAuthButton from './OAuthButton.svelte';

  type Provider = 'steam' | 'discord' | 'psn';

  let provider: Provider = 'steam';
  let loading = false;
  let psnNpsso = '';

  async function handleSteamLogin() {
    if (loading) return;
    loading = true;
    try {
      const result = await runOAuth('steam');
      if (!result.success) {
        toast.error('Connexion Steam échouée', result.error);
        return;
      }
      toast.success('Compte Steam lié');
      await authStore.createSession();
      closeAuthModal();
    } catch (e) {
      toast.error(
        'Connexion Steam échouée',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      loading = false;
    }
  }

  async function handleDiscordLogin() {
    if (loading) return;
    loading = true;
    try {
      const result = await runOAuth('discord');
      if (!result.success) {
        toast.error('Connexion Discord échouée', result.error);
        return;
      }
      toast.success('Compte Discord lié');
      await authStore.createSession();
      closeAuthModal();
    } catch (e) {
      toast.error(
        'Connexion Discord échouée',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      loading = false;
    }
  }

  async function handlePsnLogin() {
    if (loading) return;
    if (!psnNpsso.trim()) {
      toast.error('NPSSO requis', 'Colle ton token NPSSO ci-dessous');
      return;
    }
    loading = true;
    try {
      await tauriApi.authenticatePsn({ npsso: psnNpsso });
      toast.success('Compte PSN lié');
      await authStore.createSession();
      psnNpsso = '';
      closeAuthModal();
    } catch (e) {
      toast.error('Erreur PSN', e instanceof Error ? e.message : String(e));
    } finally {
      loading = false;
    }
  }
</script>

<div class="auth-modal">
  <button
    type="button"
    class="modal-backdrop"
    aria-label="Fermer la fenêtre"
    on:click={closeAuthModal}
  ></button>
  <div class="modal-content">
    <header class="modal-header">
      <h2>Lier un compte</h2>
      <button class="close-btn" on:click={closeAuthModal} aria-label="Fermer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </header>

    <div class="modal-body">
      <div class="provider-tabs">
        <button
          class:active={provider === 'steam'}
          on:click={() => provider = 'steam'}
        >
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5,4C14.67,4 14,4.67 14,5.5V7.83C13.47,7.53 12.77,7.42 12.14,7.5C11.5,7.58 11,7.95 10.66,8.46C9.67,7.63 9.12,6.17 10.07,5.23C11.02,4.29 12.42,4 14,4C15.33,4 16.5,4.53 17.3,5.54C16.85,6.13 15.97,6.45 15.1,6.51C15.48,7.06 15.5,7.55 15.5,8.5V11C15.5,12.33 14.83,13 13.5,13H10.5C9.17,13 8.5,12.33 8.5,11V8.5C8.5,7.55 8.52,7.06 8.9,6.51C8.03,6.45 7.15,6.13 6.7,5.54C7.5,4.53 8.67,4 10,4C11.33,4 12.33,4.53 13,5.54C12.55,6.13 11.67,6.45 10.8,6.5C10.42,6.05 10.4,5.5 10.4,5.5V5.5C10.4,4.67 11.07,4 12,4C13.33,4 14.33,4.53 15,5.54C14.55,6.13 13.67,6.45 12.9,6.5C13.28,7.05 13.5,7.55 13.5,8.5V11C13.5,12.33 12.83,13 11.5,13H10.5C9.17,13 8.5,12.33 8.5,11V8.5C8.5,7.67 9.17,7 10,7C10.55,7 11,7.37 11.3,7.9C11,7.39 11,6.85 11,6.5V5.5C11,4.67 11.67,4 12.5,4C13.67,4 15,5.33 15.5,7.33V11C15.5,12.33 14.83,13 14,13H10C9.17,13 9,12.33 9,11V8.5C9,7.67 9.67,7 10.5,7C10.83,7 11.33,7.33 11.66,7.83C11.33,8.34 10.83,8.83 10.5,9.5V11C10.5,12.33 9.83,13 9,13H6C4.67,13 4,12.33 4,11V8.5C4,7.55 4.5,6.83 5.3,6.33C4.5,6.67 4,7.33 4,8.5V11C4,12.33 5.33,13 7,13H9C10.67,13 12,11.67 12,10V8.5C12,7.55 11.5,6.83 10.7,6.33C11.5,6.67 12,7.33 12,8.5V11C12,12.33 10.67,13 9,13H6C4.67,13 4,12.33 4,11V8.5C4,7.67 4.67,7 5.5,7C5.83,7 5.33,6.5 5,6V5.5C5,4.67 5.67,4 6.5,4C7.67,4 8.33,4.53 9,5.54C8.55,6.13 8.17,6.45 7.9,6.5C8.28,7.05 8.5,7.55 8.5,9.5V11C8.5,12.33 7.83,13 7,13H6C4.67,13 4,12.33 4,11V8.5C4,7.67 4.67,7 5.5,7C5.83,7 5.33,6.5 5,6V5.5C5,4.67 5.67,4 6.5,4C7.67,4 8.33,4.53 9,5.54C8.55,6.13 8.17,6.45 7.9,6.5C8.28,7.05 8.5,7.55 8.5,9.5V11C8.5,12.33 7.83,13 7,13H6C4.67,13 4,12.33 4,11V8.5C4,7.67 4.67,7 5.5,7C5.83,7 5.33,6.5 5,6V5.5C5,4.67 5.67,4 6.5,4C7.67,4 8.33,4.53 9,5.54Z" />
          </svg>
          <span>Steam</span>
        </button>
        <button
          class:active={provider === 'discord'}
          on:click={() => provider = 'discord'}
        >
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317,4.37a19.791,19.791,0,0,0-4.885-1.515.074.074,0,0,0-.079.037c-.21.38-.44.735-.692,1.1a17.179,17.179,0,0,0-5.173,0c-.24-.36-.476-.72-.686-1.1a.077.077,0,0,0-.079-.037A19.736,19.736,0,0,0,3.683,4.37A.07.07,0,0,0,3.62,4.44C2.86,5.45,2.38,6.81,2.24,8.23a.077.077,0,0,0,.031.071C2.54,9.48,2.83,10.56,3.2,11.56a19.9,19.9,0,0,0,.6,2.43.077.077,0,0,0,.079.037h.056a20.116,20.116,0,0,0,5.416,2.185.077.077,0,0,0,.079-.037c.242-.377.47-.767.686-1.168a17.156,17.156,0,0,0,5.187,0,17.156,17.156,0,0,0,5.186,0c.218.401.474.786.69,1.168a.077.077,0,0,0,.079.037h.056a20.112,20.112,0,0,0,5.416-2.185.077.077,0,0,0,.079-.037,19.653,19.653,0,0,0,5.2-2.58.077.077,0,0,0-.031-.071C21.37,6.8,20.85,5.45,20.317,4.37ZM12,21.35c-3.17,0-6.13-1.23-8.32-3.37a14.37,14.37,0,0,1-1.28-3.39c0-.18.02-.36.02-.54,0-1.76,1-2.7,2.52-3.55,1.17-.65,2.72-1.5,4.41-2.1,1.42-.51,2.86-1.1,4.3-1.73a.077.077,0,0,1,.107,0c1.42.63,2.85,1.22,4.27,1.73,1.69.6,3.24,1.45,4.4,2.1,1.52.85,2.52,1.79,2.52,3.55,0,.18.02.36.02.54a13.31,13.31,0,0,1-1.28,3.39C18.13,18.12,15.17,19.35,12,21.35Z" />
          </svg>
          <span>Discord</span>
        </button>
        <button
          class:active={provider === 'psn'}
          on:click={() => provider = 'psn'}
        >
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.67,2.5a.5.5,0,0,1,.67,0l4.67,6a.5.5,0,0,1-.17.68H10.83A.5.5,0,0,1,10.5,9V3.18A.5.5,0,0,1,11,2.67ZM15.57,10.15a.5.5,0,0,1-.17-.68l-2.33-3a.5.5,0,0,1,.67-.67l2.33,3A.5.5,0,0,1,15.57,10.15ZM21.17,15.5a.5.5,0,0,1-.5.5H6.83a.5.5,0,0,1-.5-.5V10.5a.5.5,0,0,1,.5-.5H8.17a.5.5,0,0,0,0-1H2.83A1.83,1.83,0,0,0,1,11.83V20.17A1.83,1.83,0,0,0,2.83,22H21.17A1.83,1.83,0,0,0,23,20.17V16A.5.5,0,0,1,21.17,15.5ZM11.83,17.5a.5.5,0,0,1-.5-.5v-4a.5.5,0,0,1,1,0v4A.5.5,0,0,1,11.83,17.5ZM16.83,17.5a.5.5,0,0,1-.5-.5v-4a.5.5,0,0,1,1,0v4A.5.5,0,0,1,16.83,17.5Z" />
          </svg>
          <span>PlayStation</span>
        </button>
      </div>

      {#if provider === 'steam'}
        <div class="provider-panel">
          <p class="provider-desc">Connecte ton compte Steam pour importer tes succès et ta bibliothèque.</p>
          <OAuthButton
            provider="steam"
            onclick={handleSteamLogin}
            loading={loading}
          />
        </div>
      {:else if provider === 'discord'}
        <div class="provider-panel">
          <p class="provider-desc">Connecte Discord pour voir tes amis, serveurs et partager tes succès.</p>
          <OAuthButton
            provider="discord"
            onclick={handleDiscordLogin}
            loading={loading}
          />
        </div>
      {:else if provider === 'psn'}
        <div class="provider-panel">
          <p class="provider-desc">Colle ton token NPSSO pour lier ton compte PlayStation.</p>
          <div class="npsso-input">
            <label for="npsso">Token NPSSO</label>
            <input
              id="npsso"
              type="password"
              bind:value={psnNpsso}
              placeholder="Colle ton NPSSO ici..."
              autocomplete="off"
            />
            <p class="help-text">Trouve ton NPSSO sur <a href="https://ca.account.sony.com" target="_blank" rel="noopener">ca.account.sony.com</a> → Cookies → npsso</p>
          </div>
          <OAuthButton
            provider="psn"
            onclick={handlePsnLogin}
            loading={loading}
            disabled={!psnNpsso.trim()}
          />
        </div>
      {/if}
    </div>

    <footer class="modal-footer">
      <p class="footer-note">Tes identifiants ne sont jamais stockés. Seuls les tokens chiffrés sont conservés localement.</p>
    </footer>
  </div>
</div>

<style>
  .auth-modal {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .modal-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    padding: 0;
    background: rgb(0 0 0 / 70%);
    backdrop-filter: blur(4px);
    cursor: pointer;
    animation: fade-in 0.2s ease-out;
  }

  .modal-content {
    position: relative;
    width: 100%;
    max-width: 28rem;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 1rem;
    overflow: hidden;
    box-shadow: 0 20px 40px -16px rgb(0 0 0 / 60%);
    animation: slide-up 0.3s ease-out;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(1rem); }
    to { opacity: 1; transform: translateY(0); }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid hsl(var(--border));
  }

  .modal-header h2 {
    font-size: 1.125rem;
    font-weight: 700;
  }

  .close-btn {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    background: transparent;
    color: hsl(var(--muted-foreground));
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: hsl(var(--secondary));
    color: hsl(var(--foreground));
  }

  .close-btn svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  .modal-body {
    padding: 1.25rem;
  }

  .provider-tabs {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 1.25rem;
    padding: 0.2rem;
    background: hsl(var(--secondary) / 50%);
    border-radius: 9999px;
  }

  .provider-tabs button {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.85rem;
    border: none;
    border-radius: 9999px;
    background: transparent;
    color: hsl(var(--muted-foreground));
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .provider-tabs button:hover {
    color: hsl(var(--foreground));
  }

  .provider-tabs button.active {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    box-shadow: 0 4px 12px -4px hsl(var(--primary) / 60%);
  }

  .provider-tabs .icon {
    width: 1.1rem;
    height: 1.1rem;
  }

  .provider-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .provider-desc {
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.5;
  }

  .npsso-input {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .npsso-input label {
    font-size: 0.75rem;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
  }

  .npsso-input input {
    padding: 0.625rem 0.875rem;
    border: 1px solid hsl(var(--border) / 70%);
    border-radius: 0.75rem;
    background: hsl(var(--secondary) / 50%);
    color: hsl(var(--foreground));
    font-size: 0.875rem;
    outline: none;
  }

  .npsso-input input:focus {
    border-color: hsl(var(--primary) / 40%);
  }

  .help-text {
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground) / 80%);
  }

  .help-text a {
    color: hsl(var(--primary));
    text-decoration: none;
  }

  .help-text a:hover {
    text-decoration: underline;
  }

  .modal-footer {
    padding: 1rem 1.25rem;
    border-top: 1px solid hsl(var(--border) / 60%);
    background: hsl(var(--background) / 40%);
  }

  .footer-note {
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground) / 80%);
    text-align: center;
  }
</style>