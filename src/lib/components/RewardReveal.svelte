<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { onMount } from 'svelte';
  import GameCard from './GameCard.svelte';
  import { tierLabel } from '#lib/labels';
  import { NO_REWARDS, persistRewards, rewards } from '#lib/stores/sync';

  const MAX_CARDS = 10;
  const FIRST_FLIP = 320;
  const FLIP_DURATION = 420;
  /** Chaque carte démarre quand la précédente est à mi-retournement. */
  const NEXT_FLIP = FLIP_DURATION / 2;
  const PARTICLES = 18;
  const CONFETTI = 48;

  let dialog = $state<HTMLDialogElement>();
  let flipped = $state(0);

  const cards = $derived($rewards.cards.slice(0, MAX_CARDS));
  const hidden = $derived($rewards.cards.length - cards.length + $rewards.more);
  const finished = $derived(flipped >= cards.length);
  const columns = $derived(cards.length <= 3 ? cards.length : Math.ceil(cards.length / 2));

  const particles = Array.from({ length: PARTICLES }, (_, index) => ({
    angle: (index / PARTICLES) * 360,
    distance: 80 + (index % 4) * 38,
  }));

  const confetti = Array.from({ length: CONFETTI }, (_, index) => ({
    left: (index * 37) % 100,
    delay: (index * 53) % 700,
    duration: 1400 + ((index * 97) % 1100),
    drift: ((index * 71) % 160) - 80,
  }));

  onMount(persistRewards);

  $effect(() => {
    if (cards.length && !dialog?.open) dialog?.showModal();
    if (!cards.length && dialog?.open) dialog.close();
  });

  // Les cartes se retournent une à une.
  $effect(() => {
    if (!cards.length) flipped = 0;
    if (finished) return;
    const timer = setTimeout(() => (flipped += 1), flipped === 0 ? FIRST_FLIP : NEXT_FLIP);
    return () => clearTimeout(timer);
  });

  /** Un premier clic montre tout, le suivant ferme. */
  function advance() {
    if (finished) rewards.set(NO_REWARDS);
    else flipped = cards.length;
  }
</script>

<!-- Le bouton donne l'équivalent au clavier : Entrée et Échap font la même chose que le clic. -->
<dialog
  bind:this={dialog}
  onclick={advance}
  oncancel={(event) => {
    event.preventDefault();
    advance();
  }}
  onclose={(event) => {
    // Seule une action du joueur termine la révélation.
    if (cards.length) event.currentTarget.showModal();
  }}
  aria-label={m.reveal_dialog()}
  class="reward-dialog"
>
  {#if cards.length}
    <div class="reward-stage" class:finished>
      <div class="reward-rays" aria-hidden="true"></div>
      {#if finished}
        <div class="reward-finale" aria-hidden="true"></div>
        <div class="reward-confetti" aria-hidden="true">
          {#each confetti as piece, index (index)}
            <span
              style:left="{piece.left}%"
              style:--drift="{piece.drift}px"
              style:animation-delay="{piece.delay}ms"
              style:animation-duration="{piece.duration}ms"
            ></span>
          {/each}
        </div>
      {/if}

      <p class="reward-title">
        {#if cards.length > 1}
          {m.reveal_many({ count: cards.length })}
        {:else}
          {m.reveal_one({ tier: tierLabel(cards[0]?.tier ?? 1) })}
        {/if}
      </p>

      <div class="reward-grid" style:--columns={columns} style:--flip="{FLIP_DURATION}ms" inert>
        {#each cards as card, index (card.game.slug)}
          <div class="reward-scene" class:landed={index < flipped} style:--index={index}>
            {#if index < flipped}
              <div class="reward-flash" aria-hidden="true"></div>
              <div class="reward-ring" aria-hidden="true"></div>
              <div class="reward-burst" aria-hidden="true">
                {#each particles as particle (particle.angle)}
                  <span style:--angle="{particle.angle}deg" style:--distance="{particle.distance}px"
                  ></span>
                {/each}
              </div>
            {/if}
            <div class="reward-flip" class:revealed={index < flipped}>
              <div class="reward-back" aria-hidden="true">Achievers</div>
              <div class="reward-front">
                <GameCard
                  game={card.game}
                  progress={card.progress}
                  tier={card.tier}
                  copies={card.copies}
                  live
                />
              </div>
            </div>
          </div>
        {/each}
      </div>

      {#if hidden > 0}
        <p class="reward-more">{m.more_cards({ count: hidden })}</p>
      {/if}

      <button type="button" class="btn btn-primary"
        >{finished ? m.reveal_close() : m.reveal_skip()}</button
      >
    </div>
  {/if}
</dialog>
