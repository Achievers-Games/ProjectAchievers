<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { toasts } from '$lib/stores/toast';
</script>

<div
  class="fixed bottom-20 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 md:bottom-4"
>
  {#each $toasts as item (item.id)}
    <div
      class="card px-3 py-2 text-sm shadow-lg"
      class:text-danger={item.kind === 'error'}
      role={item.kind === 'error' ? 'alert' : 'status'}
      animate:flip={{ duration: 150 }}
      transition:fly={{ y: 8, duration: 150 }}
    >
      {item.message}
    </div>
  {/each}
</div>
