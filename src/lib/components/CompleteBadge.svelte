<script lang="ts">
  import Crown from '@lucide/svelte/icons/crown';
  import Gem from '@lucide/svelte/icons/gem';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Star from '@lucide/svelte/icons/star';
  import TierDots from '$lib/components/TierDots.svelte';
  import { tierLabel, tierRule } from '$lib/labels';

  let { tier = 1 }: { tier?: number } = $props();
  const icons = [Star, Star, Gem, Sparkles, Crown];
  const Icon = $derived(icons[tier] ?? Star);
</script>

<span class="complete-badge" data-tier={tier} title={tierRule(tier)}>
  <Icon size={12} aria-hidden="true" />
  {tierLabel(tier)}
  <TierDots {tier} />
</span>
