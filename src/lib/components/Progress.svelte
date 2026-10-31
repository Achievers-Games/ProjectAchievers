<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  let {
    value,
    label = m.progress(),
    tier = 0,
    step = 0,
    base = 0,
  }: { value: number; label?: string; tier?: number; step?: number; base?: number } = $props();
  const percent = $derived(Math.min(100, Math.max(0, value)));
</script>

<div
  class="progress-track h-1.5 w-full overflow-hidden rounded-full bg-raised"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(percent)}
  data-base={base || undefined}
>
  <div
    class="progress-fill h-full rounded-full"
    data-tier={tier || undefined}
    data-step={step || undefined}
    style:width="{percent}%"
  ></div>
</div>
