<script lang="ts">
  import { Lock } from '@lucide/svelte';
  import CompleteBadge from '$lib/components/CompleteBadge.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import TrophyBadge from '$lib/components/TrophyBadge.svelte';
  import { tilt } from '$lib/actions/tilt';
  import { formatDate, PLATFORM_LABELS, plural } from '$lib/labels';
  import { isComplete } from '$lib/collection';

  let { data } = $props();

  type Filter = 'tous' | 'obtenus' | 'restants';
  const complete = $derived(isComplete(data.progress));
  let filter = $state<Filter>('tous');
  let sort = $state<'rarete' | 'nom'>('rarete');

  const visible = $derived(
    data.achievements
      .filter((a) => {
        if (filter === 'obtenus') return a.unlockedAt;
        if (filter === 'restants') return !a.unlockedAt;
        return true;
      })
      .toSorted((a, b) =>
        sort === 'nom'
          ? a.name.localeCompare(b.name, 'fr')
          : (a.globalRarity ?? 101) - (b.globalRarity ?? 101),
      ),
  );

  const filters: { value: Filter; label: string }[] = [
    { value: 'tous', label: 'Tous' },
    { value: 'obtenus', label: 'Obtenus' },
    { value: 'restants', label: 'Restants' },
  ];
</script>

<svelte:head>
  <title>{data.game.name} — Project Achievers</title>
  <meta
    name="description"
    content="{plural(data.achievements.length, 'succès', 'succès')} sur {data.game
      .name} : rareté, guides et conseils."
  />
  <meta property="og:title" content={data.game.name} />
  {#if data.game.headerUrl}<meta property="og:image" content={data.game.headerUrl} />{/if}
</svelte:head>

<div class="space-y-6">
  <header class="flex flex-col gap-4 sm:flex-row">
    {#if data.game.headerUrl}
      <div
        use:tilt
        data-complete={complete || undefined}
        class="game-card relative w-full shrink-0 self-start overflow-hidden rounded-md sm:w-72"
      >
        <img src={data.game.headerUrl} alt="" class="w-full" />
        {#if complete}
          <span class="foil" aria-hidden="true"></span>
          <span class="absolute right-2 top-2"><CompleteBadge /></span>
        {/if}
      </div>
    {/if}
    <div class="min-w-0 flex-1 space-y-2">
      <h1>{data.game.name}</h1>
      <p class="text-sm text-muted">
        {PLATFORM_LABELS[data.game.platform]} · {plural(
          data.achievements.length,
          'succès',
          'succès',
        )}
        · {plural(data.players, 'joueur')}
      </p>
      {#if data.versions.length}
        <p class="flex flex-wrap gap-2 text-sm">
          {#each data.versions as version (version.slug)}
            <a href="/jeux/{version.slug}" class="btn h-8">
              Version {PLATFORM_LABELS[version.platform]}
              {#if version.completion !== null}· {Math.round(version.completion)} %{/if}
            </a>
          {/each}
        </p>
      {/if}
      {#if data.progress}
        <div class="max-w-sm space-y-1 pt-2">
          <Progress value={data.progress.completion} {complete} />
          <p class="tabular text-sm text-muted">
            {data.progress.unlockedCount} / {data.progress.totalCount} · {Math.round(
              data.progress.completion,
            )} %
          </p>
        </div>
      {/if}
    </div>
  </header>

  <div class="flex flex-wrap items-center gap-2">
    <div class="flex rounded border border-line" role="group" aria-label="Filtrer les succès">
      {#each filters as item (item.value)}
        <button
          type="button"
          onclick={() => (filter = item.value)}
          aria-pressed={filter === item.value}
          class="px-3 py-1.5 text-sm transition-colors"
          class:bg-raised={filter === item.value}
          class:text-muted={filter !== item.value}
        >
          {item.label}
        </button>
      {/each}
    </div>
    <select class="input ml-auto w-auto" aria-label="Trier les succès" bind:value={sort}>
      <option value="rarete">Les plus rares</option>
      <option value="nom">Nom</option>
    </select>
  </div>

  <ul class="card divide-y divide-line">
    {#each visible as achievement (achievement.id)}
      <li>
        <a
          href="/succes/{achievement.id}"
          class="flex items-center gap-3 p-3 transition-colors hover:bg-raised"
        >
          {#if achievement.iconUrl}
            <img
              src={achievement.iconUrl}
              alt=""
              width="40"
              height="40"
              loading="lazy"
              class="rounded"
              class:opacity-50={!achievement.unlockedAt}
            />
          {:else}
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded bg-raised text-muted">
              <Lock size={14} aria-hidden="true" />
            </span>
          {/if}
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{achievement.name}</p>
            <p class="truncate text-xs text-muted">{achievement.description}</p>
          </div>
          <div class="shrink-0 text-right">
            <TrophyBadge type={achievement.trophyType} />
            <p class="tabular text-xs text-muted">
              {#if achievement.unlockedAt}
                {formatDate(achievement.unlockedAt)}
              {:else if achievement.globalRarity !== null}
                {achievement.globalRarity.toFixed(1)} %
              {/if}
            </p>
          </div>
        </a>
      </li>
    {/each}
  </ul>
</div>
