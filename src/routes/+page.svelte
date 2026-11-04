<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import Empty from '#lib/components/Empty.svelte';
  import GameCard from '#lib/components/GameCard.svelte';
  import HomeCarousel from '#lib/components/HomeCarousel.svelte';
  import LiveCards from '#lib/components/LiveCards.svelte';
  import MissingPlatforms from '#lib/components/MissingPlatforms.svelte';
  import Podium from '#lib/components/Podium.svelte';
  import ProviderIcon from '#lib/components/ProviderIcon.svelte';
  import StatGrid from '#lib/components/StatGrid.svelte';

  let { data } = $props();
</script>

{#if data.home && data.user}
  <div class="space-y-8">
    <h1>{m.home_hello({ name: data.user.displayName })}</h1>

    <HomeCarousel
      tagline={data.tagline}
      banners={data.banners}
      avatar={data.user.avatarUrl}
      avatarMotion={data.user.avatarMotionUrl}
      member
    />

    {#if data.accounts === 0}
      <Empty title={m.home_no_account()}>
        {m.home_no_account_text()}
        {#snippet action()}<a href="/compte" class="btn btn-primary">{m.link_account()}</a
          >{/snippet}
      </Empty>
    {:else}
      <MissingPlatforms platforms={data.unlinked} />
    {/if}

    <LiveCards initial={data.cards} />

    <Podium collectors={data.podium} />

    <StatGrid
      games={data.home.stats.games}
      unlocked={data.home.stats.unlocked}
      tiers={data.home.stats.tiers}
      points={data.home.stats.points}
    />

    {#if data.home.almost.length}
      <section class="space-y-3">
        <h2>{m.home_almost()}</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.home.almost as row (row.game.id)}
            <GameCard game={row.game} progress={row} target={row.game.tier ?? 1} />
          {/each}
        </div>
      </section>
    {/if}

    {#if data.home.recent.length}
      <section class="space-y-3">
        <h2>{m.home_recent()}</h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.home.recent as row (row.game.id)}
            <GameCard game={row.game} progress={row} target={row.game.tier ?? 1} />
          {/each}
        </div>
      </section>
    {/if}
  </div>
{:else}
  <div class="space-y-10">
    <HomeCarousel tagline={data.tagline} banners={data.banners} member={false} />

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
