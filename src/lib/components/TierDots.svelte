<script lang="ts">
  let { tier }: { tier: number } = $props();

  const MAX = 4;
</script>

<!-- Du texte plutôt que des formes : il suit la couleur, même le dégradé du Prismatique. -->
<span aria-hidden="true" class="text-[0.85em] tracking-tight">
  {'●'.repeat(tier)}{'○'.repeat(Math.max(MAX - tier, 0))}
</span>
