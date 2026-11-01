<script lang="ts">
  let { copies, image }: { copies: number; image: string | null } = $props();

  /** Répartition fixe : les étincelles ne changent pas de place d'un rendu à l'autre. */
  const SPARKS = Array.from({ length: 22 }, (_, index) => ({
    left: (index * 37) % 100,
    delay: ((index * 0.73) % 3.4).toFixed(2),
    speed: (2.4 + (index % 4) * 0.5).toFixed(1),
    size: 8 + (index % 3) * 5,
    drift: ((index * 13) % 40) - 20,
  }));
</script>

<!-- ×2 : des étincelles. ×3 : le fond prend vie. ×4 : le sujet se détache. -->
<span class="card-fx" aria-hidden="true">
  {#if copies >= 3}<span class="fx-aurora"></span>{/if}
  {#if copies >= 4 && image}
    <span class="fx-halo"></span>
    <img class="fx-subject" src={image} alt="" loading="lazy" />
  {/if}
  {#each SPARKS as spark (spark.left)}
    <span
      class="fx-spark"
      style:--left="{spark.left}%"
      style:--delay="{spark.delay}s"
      style:--speed="{spark.speed}s"
      style:--size="{spark.size}px"
      style:--drift="{spark.drift}px"
    ></span>
  {/each}
</span>
