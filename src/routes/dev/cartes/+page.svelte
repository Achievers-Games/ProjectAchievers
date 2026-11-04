<script lang="ts">
  import GameCard from '#lib/components/GameCard.svelte';
  import { TIERS } from '#lib/collection';
  import { tierLabel } from '#lib/labels';

  const game = {
    name: 'Hades',
    slug: 'hades',
    platform: 'STEAM' as const,
    headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg',
    totalAchievements: 49,
  };
  const progress = { unlockedCount: 49, completion: 100, platinum: false };
</script>

<div class="space-y-8">
  {#each TIERS as tier (tier)}
    <section class="space-y-3">
      <h2>{tierLabel(tier)}</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {#each [1, 2, 3, 4] as copies (copies)}
          <GameCard {game} {progress} {tier} {copies} live />
        {/each}
      </div>
    </section>
  {/each}
</div>
