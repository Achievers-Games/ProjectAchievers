<script lang="ts">
  let {
    name,
    src = null,
    size = 32,
  }: { name: string; src?: string | null; size?: number } = $props();
</script>

{#if src}
  <img {src} alt="" width={size} height={size} class="shrink-0 rounded-full object-cover" />
{:else}
  <span
    class="grid shrink-0 place-items-center rounded-full bg-raised text-xs font-medium text-muted"
    style:width="{size}px"
    style:height="{size}px"
    aria-hidden="true"
  >
    {name.charAt(0).toUpperCase()}
  </span>
{/if}
