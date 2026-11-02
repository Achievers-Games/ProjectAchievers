<script lang="ts">
  import SiteBadge from '$lib/components/SiteBadge.svelte';
  import { m } from '$lib/paraglide/messages';
  import { dismissPop, popQueue } from '$lib/stores/achievement-pop';

  const DURATION = 5200;
  const PARTICLES = 16;

  const current = $derived($popQueue[0]);

  // Une annonce à la fois : la suivante attend que celle-ci s'efface.
  $effect(() => {
    if (!current) return;
    const id = current.id;
    const timer = setTimeout(() => dismissPop(id), DURATION);
    return () => clearTimeout(timer);
  });

  /** Des confettis lancés dans toutes les directions, un peu au hasard. */
  const particles = Array.from({ length: PARTICLES }, (_, index) => ({
    angle: (360 / PARTICLES) * index + Math.random() * 14,
    distance: 46 + Math.random() * 34,
    hue: [262, 330, 45, 190][index % 4],
    delay: Math.random() * 120,
  }));
</script>

<div class="pop-zone" aria-live="polite">
  {#key current?.id}
    {#if current}
      {@const many = current.pops.length > 1}
      {@const first = current.pops[0]!}
      <button
        type="button"
        class="pop"
        data-category={first.category}
        style:--duration="{DURATION}ms"
        onclick={() => dismissPop(current.id)}
      >
        <span class="shine" aria-hidden="true"></span>
        <span class="medal" aria-hidden="true">
          <span class="rays"></span>
          <span class="halo"></span>
          {#each particles as particle, index (index)}
            <span
              class="particle"
              style:--angle="{particle.angle}deg"
              style:--distance="{particle.distance}px"
              style:--hue={particle.hue}
              style:--delay="{particle.delay}ms"
            ></span>
          {/each}
          <span class="stack">
            {#each current.pops.slice(0, 3) as pop, index (index)}
              <span class="badge" style:--index={index}>
                <SiteBadge
                  icon={pop.icon}
                  category={pop.category}
                  level={pop.level}
                  unlocked
                  size={3.25}
                />
              </span>
            {/each}
          </span>
        </span>
        <span class="words">
          <span class="heading">
            {many ? m.ach_pop_many({ count: current.pops.length }) : m.ach_pop_heading()}
          </span>
          <span class="title">
            {many
              ? current.pops
                  .slice(0, 3)
                  .map((pop) => pop.title)
                  .join(' · ')
              : first.title}
          </span>
        </span>
        <span class="timer" aria-hidden="true"></span>
      </button>
    {/if}
  {/key}
</div>

<style>
  .pop-zone {
    position: fixed;
    left: 50%;
    bottom: 6rem;
    z-index: 60;
    transform: translateX(-50%);
    width: min(24rem, calc(100vw - 2rem));
    pointer-events: none;
  }
  @media (min-width: 768px) {
    .pop-zone {
      bottom: 2rem;
    }
  }

  .pop {
    --from: 139 108 255;
    --to: 236 92 172;
    position: relative;
    display: flex;
    width: 100%;
    align-items: center;
    gap: 1rem;
    overflow: hidden;
    padding: 0.85rem 1rem 1rem;
    border: 1px solid rgb(var(--from) / 0.55);
    border-radius: 1rem;
    background:
      radial-gradient(circle at 2.6rem 50%, rgb(var(--from) / 0.28), transparent 9rem),
      rgb(var(--surface));
    box-shadow:
      0 18px 40px -12px rgb(0 0 0 / 0.55),
      0 0 0 1px rgb(var(--to) / 0.15),
      0 0 32px -6px rgb(var(--from) / 0.6);
    color: rgb(var(--ink));
    text-align: left;
    pointer-events: auto;
    cursor: pointer;
    animation:
      pop-in 650ms cubic-bezier(0.2, 1.4, 0.4, 1) both,
      pop-out 450ms ease-in calc(var(--duration) - 450ms) forwards;
  }

  .medal {
    position: relative;
    display: grid;
    flex-shrink: 0;
    width: 3.75rem;
    height: 3.75rem;
    place-items: center;
  }

  .rays {
    position: absolute;
    inset: -1.4rem;
    border-radius: 9999px;
    background: repeating-conic-gradient(rgb(var(--from) / 0.45) 0 9deg, transparent 9deg 30deg);
    mask: radial-gradient(circle, black 30%, transparent 70%);
    animation:
      spin 6s linear infinite,
      fade-in 500ms ease-out 250ms both;
  }

  .halo {
    position: absolute;
    inset: -0.3rem;
    border-radius: 9999px;
    border: 2px solid rgb(var(--to) / 0.8);
    animation: ring 1.1s ease-out 300ms both;
  }

  .particle {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 10px;
    margin: -5px 0 0 -3px;
    border-radius: 2px;
    background: hsl(var(--hue) 90% 65%);
    opacity: 0;
    animation: burst 900ms cubic-bezier(0.15, 0.7, 0.3, 1) calc(300ms + var(--delay)) both;
  }

  .stack {
    position: relative;
    display: grid;
  }

  .badge {
    grid-area: 1 / 1;
    transform: translate(calc(var(--index) * 0.45rem), calc(var(--index) * -0.3rem))
      rotate(calc(var(--index) * 8deg));
    animation: badge-in 700ms cubic-bezier(0.2, 1.6, 0.4, 1) calc(150ms + var(--index) * 120ms) both;
  }

  .words {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.15rem;
  }

  .heading {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: linear-gradient(90deg, rgb(var(--from)), rgb(var(--to)));
    background-clip: text;
    color: transparent;
    animation: slide-in 450ms ease-out 250ms both;
  }

  .title {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    animation: slide-in 450ms ease-out 380ms both;
  }

  .shine {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      105deg,
      transparent 35%,
      rgb(255 255 255 / 0.22) 50%,
      transparent 65%
    );
    transform: translateX(-100%);
    animation: shine 1.1s ease-in-out 700ms both;
  }

  .timer {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    width: 100%;
    background: linear-gradient(90deg, rgb(var(--from)), rgb(var(--to)));
    transform-origin: left;
    animation: drain var(--duration) linear both;
  }

  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(2.5rem) scale(0.85);
    }
  }
  @keyframes pop-out {
    to {
      opacity: 0;
      transform: translateY(1rem) scale(0.95);
    }
  }
  @keyframes badge-in {
    from {
      opacity: 0;
      transform: scale(0.2) rotate(-35deg);
    }
  }
  @keyframes ring {
    from {
      opacity: 1;
      transform: scale(0.7);
    }
    to {
      opacity: 0;
      transform: scale(1.9);
    }
  }
  @keyframes burst {
    0% {
      opacity: 1;
      transform: rotate(var(--angle)) translateY(0) scale(0.6);
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: rotate(var(--angle)) translateY(calc(var(--distance) * -1)) rotate(200deg) scale(1);
    }
  }
  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateX(0.75rem);
    }
  }
  @keyframes shine {
    to {
      transform: translateX(100%);
    }
  }
  @keyframes drain {
    to {
      transform: scaleX(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pop,
    .badge,
    .heading,
    .title {
      animation: fade-in 200ms ease-out both;
    }
    .rays,
    .halo,
    .particle,
    .shine {
      display: none;
    }
    .timer {
      animation: drain var(--duration) linear both;
    }
  }

  [data-category='start'] {
    --from: 56 189 248;
    --to: 99 102 241;
  }
  [data-category='volume'] {
    --from: 251 146 60;
    --to: 239 68 68;
  }
  [data-category='rarity'] {
    --from: 244 63 94;
    --to: 168 85 247;
  }
  [data-category='time'] {
    --from: 45 212 191;
    --to: 14 116 144;
  }
  [data-category='habits'] {
    --from: 250 204 21;
    --to: 217 119 6;
  }
  [data-category='social'] {
    --from: 74 222 128;
    --to: 22 163 74;
  }
  [data-category='season'] {
    --from: 247 196 72;
    --to: 205 139 78;
  }
  [data-category='event'] {
    --from: 34 211 238;
    --to: 59 130 246;
  }
  [data-category='secret'] {
    --from: 192 132 252;
    --to: 76 29 149;
  }
  [data-category='genres'] {
    --from: 251 113 133;
    --to: 234 88 12;
  }
  [data-category='themes'] {
    --from: 52 211 153;
    --to: 8 145 178;
  }
</style>
