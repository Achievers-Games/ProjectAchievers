<script lang="ts">
  import type { Reward } from '#lib/collection';
  import { rewards } from '#lib/stores/sync';

  let { data } = $props();

  const open = (cards: Reward[]) => rewards.set({ cards, more: 0 });
</script>

<svelte:head>
  <title>Révélation — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-xl space-y-4">
  <h1>Tester la révélation</h1>
  {#if data.cards.length}
    <p class="text-sm text-muted">
      Rejoue l'animation avec tes {data.cards.length} dernières cartes, sans rien modifier.
    </p>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-primary" onclick={() => open(data.cards)}>
        Ouvrir {data.cards.length} cartes
      </button>
      <button type="button" class="btn" onclick={() => open(data.cards.slice(0, 1))}>
        Ouvrir une seule carte
      </button>
      <button type="button" class="btn" onclick={() => open(data.cards.slice(0, 3))}>
        Ouvrir 3 cartes
      </button>
    </div>
  {:else}
    <p class="text-sm text-muted">Ce compte n'a pas encore de carte 100 %.</p>
  {/if}
</div>
