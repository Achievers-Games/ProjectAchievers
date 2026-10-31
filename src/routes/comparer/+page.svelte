<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { formatNumber, formatPercent, tierLabel } from '$lib/labels';

  let { data } = $props();

  const rows = $derived([
    {
      label: m.stat_achievements(),
      left: data.leftStats.unlocked,
      right: data.rightStats.unlocked,
    },
    { label: tierLabel(1), left: data.leftStats.tiers.or, right: data.rightStats.tiers.or },
    {
      label: tierLabel(2),
      left: data.leftStats.tiers.platine,
      right: data.rightStats.tiers.platine,
    },
    {
      label: tierLabel(3),
      left: data.leftStats.tiers.prismatique,
      right: data.rightStats.tiers.prismatique,
    },
    {
      label: tierLabel(4),
      left: data.leftStats.tiers.legendaire,
      right: data.rightStats.tiers.legendaire,
    },
    { label: m.stat_points(), left: data.leftStats.points, right: data.rightStats.points },
  ]);
</script>

<svelte:head>
  <title>
    {m.comparison_title({ left: data.left.displayName, right: data.right.displayName })} — {m.comparison()}
  </title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <h1>{m.comparison()}</h1>

  <div class="card overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-line">
          <th scope="col" class="p-3 text-left font-normal text-muted">
            <span class="sr-only">{m.stat_label()}</span>
          </th>
          {#each [data.left, data.right] as person (person.id)}
            <th scope="col" class="p-3 text-right">
              <a href="/u/{person.handle}" class="inline-flex items-center gap-2 font-medium">
                <Avatar
                  name={person.displayName}
                  src={person.avatarUrl}
                  frame={person.frame}
                  motion={person.avatarMotionUrl}
                  size={24}
                />
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
    <h2>{m.common_games({ count: data.games.length })}</h2>
    {#if data.games.length === 0}
      <Empty title={m.common_games_none()} />
    {:else}
      <ul class="card divide-y divide-line">
        {#each data.games as row (row.game.id)}
          <li class="grid items-center gap-3 p-3 sm:grid-cols-[1fr_8rem_8rem]">
            <a href="/jeux/{row.game.slug}" class="truncate text-sm font-medium">{row.game.name}</a>
            {#each [row.left, row.right] as side, index (index)}
              <div class="space-y-1">
                <Progress value={side.completion} />
                <p class="tabular text-xs text-muted">{formatPercent(side.completion)}</p>
              </div>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
