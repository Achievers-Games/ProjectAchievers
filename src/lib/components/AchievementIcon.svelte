<script lang="ts">
  import { Trophy } from '@lucide/svelte';

  let { src, size, dim = false }: { src: string | null; size: number; dim?: boolean } = $props();

  let failed = $state(false);

  /** L'image peut avoir déjà échoué avant que Svelte ne prenne la main sur la page. */
  function watch(image: HTMLImageElement) {
    if (image.complete && image.naturalWidth === 0) failed = true;
  }
</script>

{#if src && !failed}
  <img
    {src}
    alt=""
    width={size}
    height={size}
    loading="lazy"
    class="shrink-0 rounded"
    class:opacity-50={dim}
    use:watch
    onerror={() => (failed = true)}
  />
{:else}
  <span
    class="grid shrink-0 place-items-center rounded bg-raised text-muted"
    style:width="{size}px"
    style:height="{size}px"
    aria-hidden="true"
  >
    <Trophy size={size / 2} />
  </span>
{/if}
