<script lang="ts" generics="T extends Translatable">
  import { m } from '#lib/paraglide/messages';
  import type { Translatable, Translations } from '#lib/translations.svelte';

  /** Le bouton « Traduire » d'un guide ou d'un commentaire. */
  let { translations, item }: { translations: Translations<T>; item: T } = $props();
</script>

<button
  type="button"
  class="text-xs text-muted hover:text-ink"
  disabled={translations.pending === item.id}
  onclick={() => translations.toggle(item)}
>
  {#if translations.pending === item.id}
    {m.translating()}
  {:else if translations.of(item)?.shown}
    {m.translate_original()}
  {:else}
    {m.translate()}
  {/if}
</button>
