<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  let {
    value,
    max = 100,
    label = m.progress(),
    tier = 0,
    step = 0,
  }: { value: number; max?: number; label?: string; tier?: number; step?: number } = $props();
  const percent = $derived(max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0);
</script>

<div
  class="progress-track h-1.5 w-full overflow-hidden rounded-full bg-raised"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={max}
  aria-valuenow={Math.min(value, max)}
>
  <div
    class="progress-fill h-full rounded-full"
    data-tier={tier || undefined}
    data-step={step || undefined}
    style:width="{percent}%"
  ></div>
</div>
