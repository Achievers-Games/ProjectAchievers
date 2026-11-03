<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { formatNumber, tierLabel } from '$lib/labels';

  let {
    games,
    unlocked,
    tiers,
    points,
  }: { games: number; unlocked: number; tiers: number[]; points: number } = $props();

  const stats = $derived<{ label: string; value: number; tier?: number }[]>([
    { label: m.stat_games(), value: games },
    { label: m.stat_achievements(), value: unlocked },
    ...tiers.map((value, index) => ({ label: tierLabel(index + 1), value, tier: index + 1 })),
    { label: m.stat_points(), value: points },
  ]);
</script>

<dl class="card grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-9 sm:divide-x sm:divide-line">
  {#each stats as stat (stat.label)}
    <div class="p-4">
      <dt class="label">{stat.label}</dt>
      <dd class="stat-value tabular mt-1" data-tier={stat.tier}>{formatNumber(stat.value)}</dd>
    </div>
  {/each}
</dl>
