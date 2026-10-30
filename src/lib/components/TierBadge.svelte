<script lang="ts">
  import { Gem, Star } from '@lucide/svelte';
  import { TIER_LABELS, type Tier } from '$lib/tiers';

  let { tier }: { tier: Tier } = $props();
  const Icon = $derived(tier === 'platine' ? Gem : Star);
</script>

<span class="tier-badge" data-tier={tier}>
  <Icon size={12} aria-hidden="true" />
  {TIER_LABELS[tier]}
</span>
