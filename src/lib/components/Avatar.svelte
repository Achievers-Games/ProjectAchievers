<script lang="ts">
  let {
    name,
    src = null,
    size = 32,
    frame = null,
  }: { name: string; src?: string | null; size?: number; frame?: string | null } = $props();
</script>

{#snippet picture()}
  {#if src}
    <img
      {src}
      alt=""
      style:width="{size}px"
      style:height="{size}px"
      class="shrink-0 rounded-full object-cover"
    />
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
{/snippet}

{#if frame}
  <span class="avatar-frame" data-frame={frame}>{@render picture()}</span>
{:else}
  {@render picture()}
{/if}
