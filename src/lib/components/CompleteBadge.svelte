<script lang="ts">
  import { Layers, Star } from '@lucide/svelte';

  let { double = false }: { double?: boolean } = $props();
  const Icon = $derived(double ? Layers : Star);
</script>

<span class="complete-badge" data-double={double || undefined}>
  <Icon size={12} aria-hidden="true" />
  {double ? 'Double 100 %' : '100 %'}
</span>
