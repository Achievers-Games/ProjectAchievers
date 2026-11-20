<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import BoosterReveal from '#lib/components/BoosterReveal.svelte';
  import { DUPLICATE_SHARDS } from '#lib/boosters';
  import type { BoosterKind, EditionKind } from '#prisma';

  /**
   * Rejoue l'ouverture avec les cartes animées des prototypes (`static/_proto`) et des indices
   * d'exemple, sans rien tirer ni dépenser.
   */
  const PROTOTYPES = [
    {
      name: 'Ori and the Will of the Wisps',
      assetPath: '/_proto/ori/',
      mythiqueAssetPath: '/_proto/ori-mythique/',
      clues: {
        genres: ['platformer', 'metroidvania'],
        achievements: 39,
        medianMinutes: 1500,
      },
    },
    {
      name: 'Hades',
      assetPath: '/_proto/hades/',
      mythiqueAssetPath: '/_proto/hades-mythique/',
      clues: {
        genres: ['roguelike'],
        achievements: 49,
        medianMinutes: 5400,
      },
    },
    {
      name: 'Hollow Knight',
      assetPath: '/_proto/hollow-knight/',
      mythiqueAssetPath: null,
      clues: {
        genres: ['metroidvania', 'soulslike'],
        achievements: 63,
        medianMinutes: 3600,
      },
    },
  ];

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
    compare?: 0 | 1;
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
      // Les comparaisons montrent la Mythique sur son propre artwork quand il existe.
      const assetPath =
        (compare !== undefined && kind === 'MYTHIQUE' && prototype.mythiqueAssetPath) ||
        prototype.assetPath;
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
        onclick={() => (shown = { id: ++count, kind: scenario.kind, editions: scenario.editions })}
      >
        {scenario.label}
      </button>
    {/each}
    {#each [0, 1] as compare (compare)}
      <button
        type="button"
        class="btn"
        onclick={() =>
          (shown = {
            id: ++count,
            kind: 'NORMAL',
            editions: ['RELIEF', 'RELIEF', 'RELIEF', 'VIVANTE', 'MYTHIQUE'],
            compare: compare === 0 ? 0 : 1,
          })}
      >
        {compare === 0 ? 'Ori' : 'Hades'} : Relief, Vivante et Mythique
      </button>
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
