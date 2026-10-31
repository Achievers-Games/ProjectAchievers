<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import Search from '@lucide/svelte/icons/search';
  import { PLATFORM_LABELS } from '$lib/labels';
  import type { Platform } from '@prisma/client';

  interface Result {
    name: string;
    slug: string;
    platform: Platform;
  }

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let dialog = $state<HTMLDialogElement>();
  let query = $state('');
  let results = $state<Result[]>([]);
  let active = $state(0);
  let loading = $state(false);
  let controller: AbortController | undefined;

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
        if (response.ok) results = await response.json();
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
    void goto(`/jeux/${result.slug}`);
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

<dialog
  bind:this={dialog}
  onclose={close}
  aria-label={m.search_dialog()}
  class="mt-[12vh] w-[36rem] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
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
  <ul
    id="palette-results"
    role="listbox"
    aria-label={m.search_results()}
    class="max-h-80 overflow-y-auto"
  >
    {#each results as result, index (result.slug)}
      <li
        id="palette-{index}"
        role="option"
        aria-selected={index === active}
        class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm"
        class:bg-raised={index === active}
        onclick={() => select(result)}
        onkeydown={onKey}
        onmouseenter={() => (active = index)}
      >
        <span class="truncate">{result.name}</span>
        <span class="shrink-0 text-xs text-muted">{PLATFORM_LABELS[result.platform]}</span>
      </li>
    {/each}
  </ul>
  {#if query.trim().length >= 2 && !loading && results.length === 0}
    <p class="px-3 py-4 text-sm text-muted">{m.search_none({ query: query.trim() })}</p>
  {/if}
</dialog>
