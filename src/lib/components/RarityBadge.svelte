<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { formatRarity } from '#lib/labels';

  /** La part de joueurs qui ont le succès, comme sur Steam, quelle que soit la plateforme. */
  let { rarity }: { rarity: number | null | undefined } = $props();
</script>

{#if rarity != null}
  <span class="tabular text-xs text-muted"
    >{m.achievement_rarity({ value: formatRarity(rarity) })}</span
  >
{/if}
