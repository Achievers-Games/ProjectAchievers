<script lang="ts">
  import type { Tier } from '$lib/tiers';

  let {
    value,
    label = 'Progression',
    tier = null,
  }: { value: number; label?: string; tier?: Tier | null } = $props();
  const percent = $derived(Math.min(100, Math.max(0, value)));
</script>

<div
  class="h-1.5 w-full overflow-hidden rounded-full bg-raised"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(percent)}
>
  <div class="progress-fill h-full rounded-full" data-tier={tier} style:width="{percent}%"></div>
</div>
