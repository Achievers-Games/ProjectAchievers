<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { dragScroll } from '#lib/actions/drag-scroll';

  /** Une rangée de cartes qui défile à la souris comme au doigt, comme le direct. */
  let { items, key, item }: { items: T[]; key: (entry: T) => string; item: Snippet<[T]> } =
    $props();
</script>

<ul class="live-rail game-rail" use:dragScroll>
  {#each items as entry (key(entry))}
    <li>{@render item(entry)}</li>
  {/each}
</ul>
