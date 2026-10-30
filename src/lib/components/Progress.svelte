<script lang="ts">
  let {
    value,
    label = 'Progression',
    complete = false,
  }: { value: number; label?: string; complete?: boolean } = $props();
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
  <div
    class="progress-fill h-full rounded-full"
    data-complete={complete || undefined}
    style:width="{percent}%"
  ></div>
</div>
