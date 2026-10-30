<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { formatNumber } from '$lib/labels';

  let { data } = $props();

  const rows = $derived([
    { label: 'Succès', left: data.leftStats.unlocked, right: data.rightStats.unlocked },
    { label: 'Cartes 100 %', left: data.leftStats.completed, right: data.rightStats.completed },
    { label: 'Double 100 %', left: data.leftStats.doubles, right: data.rightStats.doubles },
    { label: 'Points', left: data.leftStats.points, right: data.rightStats.points },
  ]);
</script>

<svelte:head>
  <title>{data.left.displayName} et {data.right.displayName} — Comparaison</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <h1>Comparaison</h1>

  <div class="card overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-line">
          <th scope="col" class="p-3 text-left font-normal text-muted">
            <span class="sr-only">Statistique</span>
          </th>
          {#each [data.left, data.right] as person (person.id)}
            <th scope="col" class="p-3 text-right">
              <a href="/u/{person.handle}" class="inline-flex items-center gap-2 font-medium">
                <Avatar name={person.displayName} src={person.avatarUrl} size={24} />
                {person.displayName}
              </a>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.label)}
          <tr class="border-b border-line last:border-0">
            <th scope="row" class="p-3 text-left font-normal text-muted">{row.label}</th>
            <td class="tabular p-3 text-right" class:font-semibold={row.left > row.right}>
              {formatNumber(row.left)}
            </td>
            <td class="tabular p-3 text-right" class:font-semibold={row.right > row.left}>
              {formatNumber(row.right)}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <section class="space-y-3">
    <h2>Jeux en commun ({data.games.length})</h2>
    {#if data.games.length === 0}
      <Empty title="Aucun jeu en commun" />
    {:else}
      <ul class="card divide-y divide-line">
        {#each data.games as row (row.game.id)}
          <li class="grid items-center gap-3 p-3 sm:grid-cols-[1fr_8rem_8rem]">
            <a href="/jeux/{row.game.slug}" class="truncate text-sm font-medium">{row.game.name}</a>
            {#each [row.left, row.right] as side, index (index)}
              <div class="space-y-1">
                <Progress value={side.completion} />
                <p class="tabular text-xs text-muted">{Math.round(side.completion)} %</p>
              </div>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
