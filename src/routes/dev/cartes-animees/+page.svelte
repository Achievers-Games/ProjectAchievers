<script lang="ts">
  import { resolve } from '$app/paths';
  import { SvelteSet } from 'svelte/reactivity';
  import { animatedCard, levelFor } from '#lib/animated-card';
  import CardInspection from '#lib/components/CardInspection.svelte';
  import type { EditionKind } from '#prisma';
  import { PROTOTYPES } from '../card-prototypes';

  const editions: { kind: EditionKind; title: string }[] = [
    { kind: 'RELIEF', title: 'Relief' },
    { kind: 'VIVANTE', title: 'Vivante' },
    { kind: 'MYTHIQUE', title: 'Mythique' },
  ];
  const rows = PROTOTYPES.map((prototype) => ({
    name: prototype.name,
    cells: editions.map((edition) => {
      const assetPath =
        edition.kind === 'MYTHIQUE' ? prototype.mythiqueAssetPath : prototype.assetPath;
      return {
        ...edition,
        card: assetPath
          ? {
              kind: edition.kind,
              assetPath,
              game: { name: prototype.name, headerUrl: `${assetPath}full.jpg` },
            }
          : null,
      };
    }),
  }));
  const cards = rows.flatMap((row) => row.cells.flatMap(({ card }) => (card ? [card] : [])));
  let selected = $state<number | null>(null);
  const visibleCards = new SvelteSet<(typeof cards)[number]>();

  function observePreview(element: HTMLButtonElement, card: (typeof cards)[number]) {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let inView = false;
    const sync = () => {
      if (inView && !motion.matches) visibleCards.add(card);
      else visibleCards.delete(card);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      sync();
    });
    observer.observe(element);
    motion.addEventListener('change', sync);
    return {
      destroy() {
        observer.disconnect();
        motion.removeEventListener('change', sync);
        visibleCards.delete(card);
      },
    };
  }
</script>

<svelte:head>
  <title>Galerie des cartes animées — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6" data-card-suspended={selected !== null ? '' : undefined}>
  <header class="flex flex-wrap items-center justify-between gap-3">
    <h1>Galerie des cartes animées</h1>
    <a class="btn" href={resolve('/dev/boosters')}>Tester les boosters</a>
  </header>

  <div class="columns text-center text-sm font-semibold">
    {#each editions as edition (edition.kind)}
      <span>{edition.title}</span>
    {/each}
  </div>
  {#each rows as row, index (row.name)}
    <section class="space-y-2" aria-labelledby={'game-' + index}>
      <h2 id={'game-' + index} class="text-base">{row.name}</h2>
      <div class="columns">
        {#each row.cells as { kind, title, card } (kind)}
          {#if card}
            <button
              type="button"
              class="preview"
              data-edition={kind.toLowerCase()}
              data-card-quality="grid"
              data-card-motion
              aria-label={'Inspecter ' + row.name + ' — ' + title}
              use:observePreview={card}
              onclick={() => (selected = cards.indexOf(card))}
            >
              <img src={card.game.headerUrl} alt="" width="920" height="430" loading="lazy" />
              {#if visibleCards.has(card)}
                <canvas
                  use:animatedCard={{ assetPath: card.assetPath, level: levelFor(kind) }}
                  aria-hidden="true"
                ></canvas>
              {/if}
            </button>
          {:else}
            <p class="placeholder text-center text-xs text-muted">Mythique à créer</p>
          {/if}
        {/each}
      </div>
      {#if row.name === 'Portal 2'}
        <a class="btn text-sm" href="/_proto/portal-2-portails/index.html"
          >Tester le relais d’Atlas et P-body</a
        >
      {/if}
    </section>
  {/each}
</div>

{#if selected !== null && cards[selected]}
  <CardInspection
    card={cards[selected]}
    position={selected + 1}
    total={cards.length}
    onclose={() => (selected = null)}
    onprevious={selected > 0 ? () => (selected = (selected ?? 0) - 1) : undefined}
    onnext={selected + 1 < cards.length ? () => (selected = (selected ?? 0) + 1) : undefined}
  />
{/if}

<style>
  .columns {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: clamp(0.4rem, 2vw, 1rem);
  }
  .preview {
    --edge: #8ca7b3;
    position: relative;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--edge) 50%, transparent);
    border-radius: 0.8rem;
    background: color-mix(in srgb, var(--edge) 7%, transparent);
  }
  .preview[data-edition='vivante'] {
    --edge: #8baa83;
  }
  .preview[data-edition='mythique'] {
    --edge: #d9a352;
  }
  .preview:hover,
  .preview:focus-visible {
    border-color: var(--edge);
  }
  .preview img {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 92 / 43;
    object-fit: cover;
  }
  .preview canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    pointer-events: none;
  }
  .preview canvas:global([data-ready]) {
    opacity: 1;
  }
  .placeholder {
    display: grid;
    place-items: center;
    border: 1px dashed currentColor;
    border-radius: 0.8rem;
  }
</style>
