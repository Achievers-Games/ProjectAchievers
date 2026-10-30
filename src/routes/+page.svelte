<script lang="ts">
  import Empty from '$lib/components/Empty.svelte';
  import GameCard from '$lib/components/GameCard.svelte';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import { formatNumber } from '$lib/labels';

  let { data } = $props();

  const stats = $derived(
    data.home
      ? [
          { label: 'Jeux', value: data.home.stats.games },
          { label: 'Succès', value: data.home.stats.unlocked },
          { label: 'Terminés', value: data.home.stats.platinums },
          { label: 'Points', value: data.home.stats.points },
        ]
      : [],
  );
</script>

{#if data.home && data.user}
  <div class="space-y-8">
    <h1>Bonjour, {data.user.displayName}</h1>

    {#if data.accounts === 0}
      <Empty title="Aucun compte de jeu lié">
        Lie Steam, PlayStation ou Xbox : ta bibliothèque et tes succès seront importés
        automatiquement.
        {#snippet action()}<a href="/compte" class="btn btn-primary">Lier un compte</a>{/snippet}
      </Empty>
    {/if}

    <dl class="card grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-line">
      {#each stats as stat (stat.label)}
        <div class="p-4">
          <dt class="label">{stat.label}</dt>
          <dd class="tabular mt-1 text-xl font-semibold">{formatNumber(stat.value)}</dd>
        </div>
      {/each}
    </dl>

    {#if data.home.almost.length}
      <section class="space-y-3">
        <h2>Presque terminés</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.home.almost as row (row.game.id)}
            <GameCard game={row.game} progress={row} />
          {/each}
        </div>
      </section>
    {/if}

    {#if data.home.recent.length}
      <section class="space-y-3">
        <h2>Derniers succès</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.home.recent as row (row.game.id)}
            <GameCard game={row.game} progress={row} />
          {/each}
        </div>
      </section>
    {/if}
  </div>
{:else}
  <div class="space-y-10">
    <section class="max-w-2xl space-y-4 py-8">
      <h1 class="text-3xl">Tous tes succès, au même endroit.</h1>
      <p class="text-muted">
        Connecte tes comptes de jeu : ta progression Steam, PlayStation et Xbox se synchronise toute
        seule. Compare-la avec tes amis et partage ton profil.
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <a href="/connexion" class="btn btn-primary">Commencer</a>
        <a href="/jeux" class="btn">Parcourir les jeux</a>
      </div>
      <div class="flex gap-4 pt-2 text-muted">
        <ProviderIcon provider="STEAM" size={20} />
        <ProviderIcon provider="PSN" size={20} />
        <ProviderIcon provider="XBOX" size={20} />
        <ProviderIcon provider="DISCORD" size={20} />
      </div>
    </section>

    {#if data.popular?.length}
      <section class="space-y-3">
        <h2>Jeux à explorer</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.popular as game (game.id)}
            <GameCard {game} />
          {/each}
        </div>
      </section>
    {/if}
  </div>
{/if}
