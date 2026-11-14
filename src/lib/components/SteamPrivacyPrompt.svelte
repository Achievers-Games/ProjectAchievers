<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { fade, scale } from 'svelte/transition';

  /** Les réglages de confidentialité du joueur connecté à Steam : `my` mène à son propre profil. */
  const STEAM_PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';
  /** « Plus tard » : la fenêtre revient le lendemain. */
  const SNOOZE = 24 * 60 * 60 * 1000;

  let { userId, hidden }: { userId: string; hidden: boolean } = $props();

  /** Par joueur : un autre compte sur le même navigateur garde sa propre réponse. */
  const key = $derived(`pa_steam_prive:${userId}`);
  let answered = $state(true);
  /** Le joueur est parti régler Steam : la fenêtre lui dit que la suite se fait toute seule. */
  let waiting = $state(false);

  function read(): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Stockage indisponible : la fenêtre reviendra à la prochaine visite.
    }
  }

  // Lu dans le navigateur seulement, et relu si le joueur change : rien ne s'affiche côté serveur.
  $effect(() => {
    const stored = read();
    answered = stored === 'jamais' || Date.now() - Number(stored ?? 0) < SNOOZE;
  });

  // Le temps de jeu est redevenu public : la prochaine alerte, s'il y en a une, repartira de zéro.
  $effect(() => {
    if (!hidden) waiting = false;
  });

  const shown = $derived(hidden && !answered);

  function later() {
    write(String(Date.now()));
    answered = true;
  }

  function never() {
    write('jamais');
    answered = true;
  }
</script>

{#if shown}
  <div class="steam-privacy" transition:fade={{ duration: 150 }}>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="steam-privacy-title"
      data-testid="steam-privacy-prompt"
      class="card w-full max-w-md space-y-4 p-5 shadow-lg"
      transition:scale={{ start: 0.96, duration: 150 }}
    >
      <h2 id="steam-privacy-title" class="text-lg">{m.steam_privacy_title()}</h2>
      <p class="text-sm text-muted">{m.steam_playtime_private()}</p>
      <p class="text-sm text-muted">
        {waiting ? m.steam_privacy_waiting() : m.steam_privacy_how()}
      </p>
      <div class="flex flex-col gap-2">
        <a
          class="btn btn-primary"
          href={STEAM_PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onclick={() => (waiting = true)}
        >
          {m.steam_playtime_private_link()}
        </a>
        <div class="flex gap-2">
          <button type="button" class="btn flex-1" onclick={later}>
            {m.steam_privacy_later()}
          </button>
          <button type="button" class="btn btn-ghost flex-1" onclick={never}>
            {m.steam_privacy_never()}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
