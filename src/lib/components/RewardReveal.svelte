<script lang="ts">
  import GameCard from './GameCard.svelte';
  import { rewards } from '$lib/stores/sync';

  const REVEAL_DELAY = 650;
  const PARTICLES = 32;

  let dialog = $state<HTMLDialogElement>();
  let revealed = $state(false);

  const current = $derived($rewards[0]);
  const remaining = $derived($rewards.length - 1);

  const particles = Array.from({ length: PARTICLES }, (_, index) => ({
    angle: (index / PARTICLES) * 360,
    distance: 130 + (index % 5) * 34,
    delay: (index % 4) * 30,
  }));

  $effect(() => {
    if (current && !dialog?.open) dialog?.showModal();
    if (!current && dialog?.open) dialog.close();
  });

  // Chaque carte arrive de dos, puis se retourne.
  $effect(() => {
    if (!current) return;
    revealed = false;
    const timer = setTimeout(() => (revealed = true), REVEAL_DELAY);
    return () => clearTimeout(timer);
  });

  const next = () => rewards.update((list) => list.slice(1));
</script>

<dialog
  bind:this={dialog}
  onclose={() => rewards.set([])}
  aria-label="Nouvelle carte"
  class="reward-dialog"
>
  {#if current}
    <div class="reward-stage" class:revealed>
      <p class="reward-title">Carte 100 % obtenue !</p>

      <div class="reward-scene">
        {#if revealed}
          <div class="reward-burst" aria-hidden="true">
            {#each particles as particle (particle.angle)}
              <span
                style:--angle="{particle.angle}deg"
                style:--distance="{particle.distance}px"
                style:animation-delay="{particle.delay}ms"
              ></span>
            {/each}
          </div>
        {/if}

        <div class="reward-flip">
          <div class="reward-back" aria-hidden="true">Achievers</div>
          <div class="reward-front">
            {#key current.game.slug}
              <GameCard game={current.game} progress={current.progress} />
            {/key}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        {#if remaining > 0}
          <button type="button" class="btn btn-primary" onclick={next}>
            Carte suivante ({remaining})
          </button>
        {:else}
          <button type="button" class="btn btn-primary" onclick={next}>Super !</button>
        {/if}
      </div>
    </div>
  {/if}
</dialog>
