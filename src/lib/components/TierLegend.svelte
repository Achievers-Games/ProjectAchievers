<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import CompleteBadge from '$lib/components/CompleteBadge.svelte';
  import { tierRule } from '$lib/labels';
</script>

<details class="text-sm" data-testid="tier-legend">
  <summary class="w-fit cursor-pointer text-muted">{m.tiers_how()}</summary>
  <div class="card mt-2 space-y-3 p-4">
    <p class="text-muted">{m.tiers_how_text()}</p>
    <ul class="grid gap-2 sm:grid-cols-2">
      {#each [1, 2, 3, 4] as tier (tier)}
        <li class="flex flex-wrap items-center gap-2">
          <CompleteBadge {tier} />
          <span>{tierRule(tier)}</span>
        </li>
      {/each}
    </ul>
  </div>
</details>
