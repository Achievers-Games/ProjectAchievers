<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import Empty from '$lib/components/Empty.svelte';
  import GameCard from '$lib/components/GameCard.svelte';
  import HomeCarousel from '$lib/components/HomeCarousel.svelte';
  import LiveCards from '$lib/components/LiveCards.svelte';
  import Podium from '$lib/components/Podium.svelte';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import { formatNumber, tierLabel } from '$lib/labels';

  let { data } = $props();

  const stats = $derived(
    data.home
      ? [
          { label: m.stat_games(), value: data.home.stats.games },
          { label: m.stat_achievements(), value: data.home.stats.unlocked },
          { label: tierLabel(1), value: data.home.stats.tiers.or, tier: 1 },
          { label: tierLabel(2), value: data.home.stats.tiers.platine, tier: 2 },
          { label: tierLabel(3), value: data.home.stats.tiers.prismatique, tier: 3 },
          { label: tierLabel(4), value: data.home.stats.tiers.legendaire, tier: 4 },
          { label: m.stat_points(), value: data.home.stats.points },
        ]
      : [],
  );
</script>

{#if data.home && data.user}
  <div class="space-y-8">
    <h1>{m.home_hello({ name: data.user.displayName })}</h1>

    <HomeCarousel tagline={data.tagline} member />

    {#if data.accounts === 0}
      <Empty title={m.home_no_account()}>
        {m.home_no_account_text()}
        {#snippet action()}<a href="/compte" class="btn btn-primary">{m.link_account()}</a
          >{/snippet}
      </Empty>
    {/if}

    <LiveCards initial={data.cards} />

    <Podium collectors={data.podium} />

    <dl class="card grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 sm:divide-x sm:divide-line">
      {#each stats as stat (stat.label)}
        <div class="p-4">
          <dt class="label">{stat.label}</dt>
          <dd class="stat-value tabular mt-1" data-tier={stat.tier}>
            {formatNumber(stat.value)}
          </dd>
        </div>
      {/each}
    </dl>

    {#if data.home.almost.length}
      <section class="space-y-3">
        <h2>{m.home_almost()}</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.home.almost as row (row.game.id)}
            <GameCard game={row.game} progress={row} />
          {/each}
        </div>
      </section>
    {/if}

    {#if data.home.recent.length}
      <section class="space-y-3">
        <h2>{m.home_recent()}</h2>
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
    <HomeCarousel tagline={data.tagline} member={false} />

    <section class="max-w-2xl space-y-4">
      <h1 class="hero-title">{m.hero_title()}</h1>
      <p class="text-muted">
        {m.hero_text()}
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <a href="/connexion" class="btn btn-primary">{m.hero_start()}</a>
        <a href="/jeux" class="btn">{m.hero_browse()}</a>
      </div>
      <div class="flex gap-4 pt-2 text-muted">
        <ProviderIcon provider="STEAM" size={20} />
        <ProviderIcon provider="PSN" size={20} />
        <ProviderIcon provider="XBOX" size={20} />
        <ProviderIcon provider="DISCORD" size={20} />
      </div>
    </section>

    <LiveCards initial={data.cards} />

    <Podium collectors={data.podium} />

    {#if data.popular?.length}
      <section class="space-y-3">
        <h2>{m.home_explore()}</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.popular as game (game.id)}
            <GameCard {game} />
          {/each}
        </div>
      </section>
    {/if}
  </div>
{/if}
