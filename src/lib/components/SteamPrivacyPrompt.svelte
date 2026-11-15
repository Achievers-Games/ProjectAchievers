<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { fade, scale } from 'svelte/transition';

  /** Les réglages de confidentialité du joueur connecté à Steam : `my` mène à son propre profil. */
  const STEAM_PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';
  /** « Plus tard » : la fenêtre revient le lendemain. */
  const SNOOZE = 24 * 60 * 60 * 1000;
  /** Tant que la fenêtre est ouverte, le site demande à Steam si le joueur l'a réglé. */
  const POLL = 5_000;

  /**
   * Ce que Steam cache : toute la bibliothèque (profil ou détails des jeux privés), ou seulement le
   * temps de jeu. Les deux se règlent sur la même page : le premier cas demande tout d'un coup.
   */
  let { userId, issue }: { userId: string; issue: 'library' | 'playtime' | null } = $props();

  /** Par joueur : un autre compte sur le même navigateur garde sa propre réponse. */
  const key = $derived(`pa_steam_prive:${userId}`);
  let answered = $state(true);
  /** Le joueur est parti régler Steam pour ce problème : la suite se fait toute seule. */
  let waitingFor = $state<typeof issue>(null);
  /**
   * Steam montre de nouveau ce qui manquait : la synchronisation est partie, la fenêtre s'efface.
   * Si elle trouve encore le temps de jeu caché, la fenêtre revient pour lui seul.
   */
  let fixedIssue = $state<typeof issue>(null);

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

  // Plus rien de caché : la prochaine alerte, s'il y en a une, repartira de zéro. Un « Plus tard »
  // ne vaut que pour cette fois ; seul « Ne plus afficher » se garde.
  $effect(() => {
    if (issue) return;
    waitingFor = null;
    fixedIssue = null;
    if (read() === 'jamais') return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Stockage indisponible : rien n'y a été gardé.
    }
    answered = false;
  });

  const shown = $derived(!!issue && !answered && fixedIssue !== issue);

  async function check() {
    const asked = issue;
    const response = await fetch('/api/sync/steam-prive', { method: 'POST' }).catch(() => null);
    if (!response?.ok) return;
    const result = (await response.json()) as { fixed: boolean };
    if (result.fixed) fixedIssue = asked;
  }

  // Fenêtre ouverte : une question toutes les 5 s, et une tout de suite au retour sur l'onglet,
  // le joueur revenant de Steam. Elle se ferme, d'elle-même ou par « Plus tard » : plus rien.
  $effect(() => {
    if (!shown) return;
    const timer = setInterval(check, POLL);
    const back = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', back);
    };
  });

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
      <p class="text-sm text-muted">
        {issue === 'library' ? m.steam_library_private() : m.steam_playtime_private()}
      </p>
      <p class="text-sm text-muted">
        {#if waitingFor === issue}
          {m.steam_privacy_waiting()}
        {:else if issue === 'library'}
          {m.steam_privacy_how_all()}
        {:else}
          {m.steam_privacy_how()}
        {/if}
      </p>
      <div class="flex flex-col gap-2">
        <a
          class="btn btn-primary"
          href={STEAM_PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onclick={() => (waitingFor = issue)}
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
