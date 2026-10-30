<script lang="ts">
  let {
    value,
    label = 'Progression',
    tier = 0,
    step = 0,
  }: { value: number; label?: string; tier?: number; step?: number } = $props();
  const percent = $derived(Math.min(100, Math.max(0, value)));
</script>

<div
  class="progress-track h-1.5 w-full overflow-hidden rounded-full bg-raised"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(percent)}
>
  <div
    class="progress-fill h-full rounded-full"
    data-tier={tier || undefined}
    data-step={step || undefined}
    style:width="{percent}%"
  ></div>
</div>
