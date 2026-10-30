<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { LayoutGrid, List } from '@lucide/svelte';
  import Empty from '$lib/components/Empty.svelte';
  import GameCard from '$lib/components/GameCard.svelte';
  import { plural } from '$lib/labels';

  let { data } = $props();

  let timer: ReturnType<typeof setTimeout>;

  /** Les filtres vivent dans l'URL : une vue filtrée se partage et survit au rechargement. */
  function hrefWith(changes: Record<string, string | null>) {
    const next = new URLSearchParams(page.url.searchParams);
    if (!('page' in changes)) next.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const search = next.toString();
    return search ? `/jeux?${search}` : '/jeux';
  }

  const apply = (changes: Record<string, string | null>) =>
    goto(hrefWith(changes), { keepFocus: true, noScroll: true, replaceState: true });

  function onSearch(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(() => apply({ q: value || null }), 200);
  }

  const platforms = [
    { value: null, label: 'Toutes' },
    { value: 'STEAM', label: 'Steam' },
    { value: 'PSN', label: 'PlayStation' },
    { value: 'XBOX', label: 'Xbox' },
  ];
</script>

<svelte:head><title>Jeux — Project Achievers</title></svelte:head>

<div class="space-y-5">
  <div class="flex items-baseline justify-between gap-4">
    <h1>Jeux</h1>
    <p class="tabular text-sm text-muted">{plural(data.total, 'jeu', 'jeux')}</p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <input
      type="search"
      value={data.params.q ?? ''}
      oninput={onSearch}
      placeholder="Filtrer par nom…"
      aria-label="Filtrer par nom"
      class="input sm:w-64"
    />

    <div class="flex rounded border border-line" role="group" aria-label="Plateforme">
      {#each platforms as platform (platform.label)}
        <a
          href={hrefWith({ plateforme: platform.value })}
          data-sveltekit-noscroll
          aria-current={(data.params.plateforme ?? null) === platform.value ? 'true' : undefined}
          class="px-3 py-1.5 text-sm transition-colors"
          class:bg-raised={(data.params.plateforme ?? null) === platform.value}
          class:text-muted={(data.params.plateforme ?? null) !== platform.value}
        >
          {platform.label}
        </a>
      {/each}
    </div>

    {#if data.user}
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={data.params.mine}
          onchange={(event) => apply({ miens: event.currentTarget.checked ? '1' : null })}
        />
        Mes jeux
      </label>
    {/if}

    <div class="ml-auto flex items-center gap-2">
      <select
        class="input w-auto"
        aria-label="Trier"
        value={data.params.tri}
        onchange={(event) => apply({ tri: event.currentTarget.value })}
      >
        <option value="nom">Nom</option>
        <option value="succes">Nombre de succès</option>
        <option value="recent">Mis à jour</option>
        {#if data.params.mine}<option value="progression">Progression</option>{/if}
      </select>
      <a
        href={hrefWith({ vue: data.params.vue === 'grille' ? 'liste' : null })}
        data-sveltekit-noscroll
        class="btn w-9 px-0"
        aria-label={data.params.vue === 'grille' ? 'Afficher en liste' : 'Afficher en grille'}
      >
        {#if data.params.vue === 'grille'}<List size={16} />{:else}<LayoutGrid size={16} />{/if}
      </a>
    </div>
  </div>

  {#if data.games.length === 0}
    <Empty title="Aucun jeu trouvé">
      Essaie un autre filtre. Le catalogue s'enrichit à chaque synchronisation.
    </Empty>
  {:else}
    <div class={data.params.vue === 'liste' ? 'grid gap-2' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
      {#each data.games as game (game.id)}
        <GameCard {game} progress={game.progress} layout={data.params.vue} />
      {/each}
    </div>
  {/if}

  {#if data.pages > 1}
    <nav class="flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
      {#if data.params.page > 1}
        <a class="btn" href={hrefWith({ page: String(data.params.page - 1) })}>Précédent</a>
      {/if}
      <span class="tabular text-muted">{data.params.page} / {data.pages}</span>
      {#if data.params.page < data.pages}
        <a class="btn" href={hrefWith({ page: String(data.params.page + 1) })}>Suivant</a>
      {/if}
    </nav>
  {/if}
</div>
