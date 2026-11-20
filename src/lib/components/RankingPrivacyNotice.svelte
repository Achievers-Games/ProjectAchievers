<script lang="ts">
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import { page } from '$app/state';
  import { m } from '#lib/paraglide/messages';

  /** Un temps de jeu Steam privé sort le joueur des classements : il doit savoir pourquoi. */
  const hidden = $derived(page.data.steamPrivacy === 'playtime');
</script>

{#if hidden}
  <p class="flex items-start gap-2 rounded-md border border-line bg-surface p-3 text-sm">
    <EyeOff size={16} class="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
    <span>{m.steam_ranking_hidden()} {m.steam_privacy_how()}</span>
  </p>
{/if}
