<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    children,
    action,
  }: { title: string; children?: Snippet; action?: Snippet } = $props();
</script>

<div class="card flex flex-col items-center gap-2 px-6 py-10 text-center">
  <p class="font-medium">{title}</p>
  {#if children}<p class="max-w-md text-sm text-muted">{@render children()}</p>{/if}
  {#if action}<div class="mt-2">{@render action()}</div>{/if}
</div>
