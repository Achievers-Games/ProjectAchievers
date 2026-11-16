<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import Search from '@lucide/svelte/icons/search';
  import Avatar from './Avatar.svelte';
  import { PLATFORM_LABELS } from '#lib/labels';
  import type { Platform } from '#prisma';

  interface Game {
    name: string;
    slug: string;
    platform: Platform;
  }

  interface Player {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    frame: string | null;
  }

  /** Une seule liste pour le clavier : les joueurs d'abord, puis les jeux. */
  type Result =
    | { kind: 'player'; key: string; href: string; player: Player }
    | { kind: 'game'; key: string; href: string; game: Game };

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let dialog = $state<HTMLDialogElement>();
  let query = $state('');
  let results = $state<Result[]>([]);
  let active = $state(0);
  let loading = $state(false);
  let controller: AbortController | undefined;

  const players = $derived(results.filter((result) => result.kind === 'player'));
  const games = $derived(results.filter((result) => result.kind === 'game'));

  $effect(() => {
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  });

  $effect(() => {
    const term = query.trim();
    controller?.abort();
    active = 0;
    if (term.length < 2) {
      results = [];
      loading = false;
      return;
    }
    loading = true;
    const current = new AbortController();
    controller = current;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: current.signal,
        });
        if (response.ok) {
          const found = (await response.json()) as { games: Game[]; players: Player[] };
          results = [
            ...found.players.map((player) => ({
              kind: 'player' as const,
              key: `u-${player.handle}`,
              href: `/u/${player.handle}`,
              player,
            })),
            ...found.games.map((game) => ({
              kind: 'game' as const,
              key: `g-${game.slug}`,
              href: `/jeux/${game.slug}`,
              game,
            })),
          ];
        }
        loading = false;
      } catch {
        // Requête annulée par une frappe plus récente.
      }
    }, 150);
    return () => clearTimeout(timer);
  });

  function onGlobalKey(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open = !open;
    }
  }

  function close() {
    open = false;
    query = '';
  }

  function select(result: Result | undefined) {
    if (!result) return;
    close();
    void goto(result.href);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(active + 1, results.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(results[active]);
    }
  }
</script>

<svelte:window onkeydown={onGlobalKey} />

{#snippet option(result: Result)}
  {@const index = results.indexOf(result)}
  <li
    id="palette-{index}"
    role="option"
    aria-selected={index === active}
    class="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm"
    class:bg-raised={index === active}
    tabindex="-1"
    onclick={() => select(result)}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') select(result);
    }}
    onmouseenter={() => (active = index)}
  >
    {#if result.kind === 'player'}
      <span class="flex min-w-0 items-center gap-2">
        <Avatar person={result.player} size={24} />
        <span class="truncate">{result.player.displayName}</span>
      </span>
      <span class="shrink-0 text-xs text-muted">@{result.player.handle}</span>
    {:else}
      <span class="truncate">{result.game.name}</span>
      <span class="shrink-0 text-xs text-muted">{PLATFORM_LABELS[result.game.platform]}</span>
    {/if}
  </li>
{/snippet}

<!-- Le préréglage CSS remet les marges à zéro : sans `mx-auto`, la fenêtre se colle à gauche. -->
<dialog
  bind:this={dialog}
  onclose={close}
  aria-label={m.search_dialog()}
  class="mx-auto mt-[12vh] w-[36rem] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
>
  <div class="flex items-center gap-2 border-b border-line px-3">
    <Search size={16} class="text-muted" aria-hidden="true" />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:value={query}
      onkeydown={onKey}
      autofocus
      type="search"
      role="combobox"
      aria-expanded={results.length > 0}
      aria-controls="palette-results"
      aria-activedescendant={results.length ? `palette-${active}` : undefined}
      aria-label={m.search_game()}
      placeholder={m.search_placeholder()}
      class="h-11 w-full bg-transparent text-sm outline-none"
    />
  </div>
  <div
    id="palette-results"
    role="listbox"
    aria-label={m.search_results()}
    class="max-h-96 overflow-y-auto"
  >
    {#if players.length}
      <ul role="group" aria-labelledby="palette-players">
        <li
          id="palette-players"
          role="presentation"
          class="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {m.search_players()}
        </li>
        {#each players as result (result.key)}{@render option(result)}{/each}
      </ul>
    {/if}
    {#if games.length}
      <ul role="group" aria-labelledby="palette-games">
        <li
          id="palette-games"
          role="presentation"
          class="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {m.search_games()}
        </li>
        {#each games as result (result.key)}{@render option(result)}{/each}
      </ul>
    {/if}
  </div>
  {#if query.trim().length >= 2 && !loading && results.length === 0}
    <p class="px-3 py-4 text-sm text-muted">{m.search_none({ query: query.trim() })}</p>
  {/if}
</dialog>
