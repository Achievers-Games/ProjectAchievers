<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { subscribeJson } from '#lib/sse';

  let { handle }: { handle: string } = $props();
  let playing = $state<{ name: string; slug: string; platform?: 'PSN' | 'RETRO' } | null>(null);

  $effect(() => {
    const url = `/u/${encodeURIComponent(handle)}/jeu-en-cours`;
    let stop: (() => void) | undefined;
    function update() {
      stop?.();
      stop = undefined;
      playing = null;
      if (!document.hidden) {
        stop = subscribeJson<typeof playing>(url, (game) => (playing = game));
      }
    }
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      stop?.();
      document.removeEventListener('visibilitychange', update);
    };
  });
</script>

{#if playing}
  <a href="/jeux/{playing.slug}" class="block truncate text-xs text-muted hover:text-ink">
    {playing.platform === 'PSN'
      ? m.profile_playing_playstation({ game: playing.name })
      : playing.platform === 'RETRO'
        ? m.profile_playing_retro({ game: playing.name })
        : m.profile_playing_steam({ game: playing.name })}
  </a>
{/if}
