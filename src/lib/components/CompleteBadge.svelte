<script lang="ts">
  import { Crown, Gem, Sparkles, Star } from '@lucide/svelte';
  import { tierLabel } from '$lib/labels';

  let { tier = 1 }: { tier?: number } = $props();
  const icons = [Star, Star, Gem, Sparkles, Crown];
  const Icon = $derived(icons[tier] ?? Star);
</script>

<span class="complete-badge" data-tier={tier}>
  <Icon size={12} aria-hidden="true" />
  {tierLabel(tier)}
</span>
