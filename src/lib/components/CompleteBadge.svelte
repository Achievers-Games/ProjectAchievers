<script lang="ts">
  import Crown from '@lucide/svelte/icons/crown';
  import Gem from '@lucide/svelte/icons/gem';
  import Medal from '@lucide/svelte/icons/medal';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Star from '@lucide/svelte/icons/star';
  import Target from '@lucide/svelte/icons/target';
  import { m } from '#lib/paraglide/messages';
  import { tierLabel, tierRule } from '#lib/labels';

  /** `goal` : la carte n'est pas encore gagnée, c'est celle qui attend au bout du 100 %. */
  let {
    tier = 1,
    copies = 1,
    goal = false,
  }: { tier?: number; copies?: number; goal?: boolean } = $props();
  const icons = [Medal, Medal, Medal, Star, Gem, Sparkles, Crown];
  const Icon = $derived(goal ? Target : (icons[tier] ?? Medal));
</script>

<span
  class="complete-badge"
  data-tier={tier}
  data-goal={goal || undefined}
  title={goal ? m.card_goal_help({ tier: tierLabel(tier), rule: tierRule(tier) }) : tierRule(tier)}
>
  <Icon size={12} aria-hidden="true" />
  {tierLabel(tier)}
  {#if copies > 1}
    <span class="copies" title={m.copies_help({ count: copies })}>×{copies}</span>
  {/if}
</span>
