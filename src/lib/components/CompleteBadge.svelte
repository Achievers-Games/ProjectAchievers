<script lang="ts">
  import Crown from '@lucide/svelte/icons/crown';
  import Gem from '@lucide/svelte/icons/gem';
  import Medal from '@lucide/svelte/icons/medal';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Star from '@lucide/svelte/icons/star';
  import { m } from '$lib/paraglide/messages';
  import { tierLabel, tierRule } from '$lib/labels';

  let { tier = 1, copies = 1 }: { tier?: number; copies?: number } = $props();
  const icons = [Medal, Medal, Medal, Star, Gem, Sparkles, Crown];
  const Icon = $derived(icons[tier] ?? Medal);
</script>

<span class="complete-badge" data-tier={tier} title={tierRule(tier)}>
  <Icon size={12} aria-hidden="true" />
  {tierLabel(tier)}
  {#if copies > 1}
    <span class="copies" title={m.copies_help({ count: copies })}>×{copies}</span>
  {/if}
</span>
