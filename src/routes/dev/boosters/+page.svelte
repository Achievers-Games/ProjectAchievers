<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '#lib/paraglide/messages';
  import BoosterReveal from '#lib/components/BoosterReveal.svelte';
  import { DUPLICATE_SHARDS } from '#lib/boosters';
  import type { BoosterKind, EditionKind } from '#prisma';

  import { PROTOTYPES } from '../card-prototypes';

  const SCENARIOS: { label: string; kind: BoosterKind; editions: EditionKind[] }[] = [
    {
      label: 'Cinq Relief',
      kind: 'NORMAL',
      editions: ['RELIEF', 'RELIEF', 'RELIEF', 'RELIEF', 'RELIEF'],
    },
    {
      label: 'Une Vivante',
      kind: 'NORMAL',
      editions: ['RELIEF', 'RELIEF', 'RELIEF', 'RELIEF', 'VIVANTE'],
    },
    {
      label: 'Booster doré',
      kind: 'GOLDEN',
      editions: ['RELIEF', 'RELIEF', 'RELIEF', 'VIVANTE', 'VIVANTE'],
    },
    {
      label: 'Une Mythique',
      kind: 'NORMAL',
      editions: ['RELIEF', 'RELIEF', 'RELIEF', 'VIVANTE', 'MYTHIQUE'],
    },
  ];

  let shown = $state<{
    id: number;
    kind: BoosterKind;
    editions: EditionKind[];
    compare?: number;
  } | null>(null);
  let count = 0;
  /** Le prototype qui joue la carte la plus rare du booster. */
  let star = $state(2);

  const cards = $derived(
    (shown?.editions ?? []).map((kind, index) => {
      const compare = shown?.compare;
      // La dernière carte, la plus rare, est le prototype choisi ; les autres suivent.
      const prototype =
        compare !== undefined
          ? PROTOTYPES[index < 2 ? (compare + index + 1) % PROTOTYPES.length : compare]!
          : PROTOTYPES[
              (star + index + 1 + PROTOTYPES.length * 2 - (shown?.editions.length ?? 0)) %
                PROTOTYPES.length
            ]!;
      // Chaque Mythique utilise son propre artwork quand il existe.
      const assetPath = (kind === 'MYTHIQUE' && prototype.mythiqueAssetPath) || prototype.assetPath;
      return {
        kind,
        // La deuxième carte joue le doublon, pour voir les éclats rendus.
        duplicate: index === 1,
        shards: index === 1 ? DUPLICATE_SHARDS[kind] : 0,
        game: {
          name: prototype.name,
          headerUrl: `${assetPath}full.jpg`,
        },
        assetPath,
        clues: kind === 'RELIEF' ? null : prototype.clues,
      };
    }),
  );
</script>

<svelte:head>
  <title>Ouverture de booster — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-xl space-y-4">
  <h1>Tester l'ouverture d'un booster</h1>
  <a class="btn" href={resolve('/dev/cartes-animees')}>Galerie des cartes animées</a>
  <p class="text-sm text-muted">
    Rejoue la scène avec les cartes animées des prototypes, sans rien tirer ni dépenser. La Mythique
    est la dernière carte du booster.
  </p>
  <div class="flex flex-wrap items-center gap-2 text-sm">
    <span class="text-muted">Carte rare :</span>
    {#each PROTOTYPES as prototype, index (prototype.name)}
      <button
        type="button"
        class="btn"
        class:btn-primary={star === index}
        onclick={() => (star = index)}
      >
        {prototype.name}
      </button>
    {/each}
  </div>
  <div class="flex flex-wrap gap-2">
    {#each SCENARIOS as scenario (scenario.label)}
      <button
        type="button"
        class="btn"
        disabled={scenario.editions.includes('MYTHIQUE') && !PROTOTYPES[star]?.mythiqueAssetPath}
        onclick={() => (shown = { id: ++count, kind: scenario.kind, editions: scenario.editions })}
      >
        {scenario.label}
      </button>
    {/each}
    {#each PROTOTYPES as prototype, compare (prototype.name)}
      {#if prototype.mythiqueAssetPath}
        <button
          type="button"
          class="btn"
          onclick={() =>
            (shown = {
              id: ++count,
              kind: 'NORMAL',
              editions: ['RELIEF', 'RELIEF', 'RELIEF', 'VIVANTE', 'MYTHIQUE'],
              compare,
            })}
        >
          {compare === 0 ? 'Ori' : prototype.name} : Relief, Vivante et Mythique
        </button>
      {/if}
    {/each}
  </div>
</div>

{#if shown}
  {#key shown.id}
    <!-- « Ouvrir le suivant » rejoue le même scénario, comme un nouveau booster. -->
    <BoosterReveal
      {cards}
      kind={shown.kind}
      next={{
        label: m.booster_open_next(),
        open: () => (shown = shown && { ...shown, id: ++count }),
      }}
      collectionHref="/boosters/collection"
      onclose={() => (shown = null)}
    />
  {/key}
{/if}
