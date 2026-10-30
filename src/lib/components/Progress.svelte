<script lang="ts">
  let { value, label = 'Progression' }: { value: number; label?: string } = $props();
  const percent = $derived(Math.min(100, Math.max(0, value)));
</script>

<div
  class="h-1 w-full overflow-hidden rounded-full bg-raised"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(percent)}
>
  <div
    class="h-full rounded-full bg-accent transition-[width] duration-200"
    style:width="{percent}%"
  ></div>
</div>
