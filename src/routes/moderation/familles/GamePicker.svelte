<script lang="ts">
  import { PLATFORM_LABELS } from '#lib/labels';
  import type { Platform } from '#prisma';

  interface Game {
    id: string;
    name: string;
    platform: Platform;
    coverUrl: string | null;
  }

  let {
    name,
    label,
    placeholder,
    exclude = [],
  }: { name: string; label: string; placeholder: string; exclude?: string[] } = $props();

  const listId = $props.id();
  let query = $state('');
  let results = $state<Game[]>([]);
  let chosen = $state<Game | null>(null);
  let active = $state(0);
  let open = $state(false);

  const shown = $derived(results.filter((game) => !exclude.includes(game.id)));

  $effect(() => {
    const term = query.trim();
    // Un formulaire remis à zéro après l'envoi vide le champ : le choix part avec lui.
    if (!term) chosen = null;
    if (chosen || term.length < 2) {
      results = [];
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/moderation/familles/jeux?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          results = await response.json();
          active = 0;
          open = true;
        }
      } catch {
        // Une saisie plus récente a remplacé cette recherche.
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  function pick(game: Game) {
    chosen = game;
    query = `${game.name} · ${PLATFORM_LABELS[game.platform]}`;
    open = false;
  }

  function keydown(event: KeyboardEvent) {
    if (!open || !shown.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + shown.length) % shown.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(shown[active]!);
    } else if (event.key === 'Escape') {
      open = false;
    }
  }
</script>

<div class="relative min-w-0 flex-1">
  <input type="hidden" {name} value={chosen?.id ?? ''} />
  <input
    role="combobox"
    aria-label={label}
    aria-expanded={open && shown.length > 0}
    aria-controls={listId}
    aria-activedescendant={open && shown.length ? `${listId}-${active}` : undefined}
    autocomplete="off"
    {placeholder}
    class="input w-full"
    bind:value={query}
    oninput={() => (chosen = null)}
    onkeydown={keydown}
    onblur={() => setTimeout(() => (open = false), 150)}
  />
  {#if open && shown.length}
    <ul
      id={listId}
      role="listbox"
      class="card absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto p-1 shadow-lg"
    >
      {#each shown as game, index (game.id)}
        <li
          id="{listId}-{index}"
          role="option"
          aria-selected={index === active}
          class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm {index === active
            ? 'bg-line'
            : ''}"
          onmousedown={(event) => {
            event.preventDefault();
            pick(game);
          }}
          onmouseenter={() => (active = index)}
        >
          {#if game.coverUrl}
            <img src={game.coverUrl} alt="" class="h-6 w-10 shrink-0 rounded object-cover" />
          {/if}
          <span class="min-w-0 truncate">{game.name}</span>
          <span class="ml-auto shrink-0 text-muted">{PLATFORM_LABELS[game.platform]}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
