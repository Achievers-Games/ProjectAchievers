<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import Seo from '#lib/components/Seo.svelte';
  import { page } from '$app/state';
  import Empty from '#lib/components/Empty.svelte';
  import Avatar from '#lib/components/Avatar.svelte';
  import GameCard from '#lib/components/GameCard.svelte';
  import GameRail from '#lib/components/GameRail.svelte';
  import { formatRelative } from '#lib/labels';
  import HomeCarousel from '#lib/components/HomeCarousel.svelte';
  import LiveCards from '#lib/components/LiveCards.svelte';
  import MissingPlatforms from '#lib/components/MissingPlatforms.svelte';
  import Podium from '#lib/components/Podium.svelte';
  import ProviderIcon from '#lib/components/ProviderIcon.svelte';
  import StatGrid from '#lib/components/StatGrid.svelte';

  let { data } = $props();
</script>

<Seo
  title="Project Achievers"
  description={m.site_description()}
  jsonLd={{
    '@type': 'WebSite',
    name: 'Project Achievers',
    url: page.url.origin,
  }}
/>

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

    <div class="home-panel"><LiveCards initial={data.cards} /></div>

    <section class="home-panel" aria-labelledby="amis-jouent">
      <div class="flex items-baseline justify-between gap-4">
        <h2 id="amis-jouent">{m.home_friends_playing()}</h2>
        <a href="/amis" class="text-sm text-muted hover:text-ink">{m.nav_friends()}</a>
      </div>
      {#if data.friends.length}
        <GameRail items={data.friends} key={(row) => `${row.user.handle}-${row.game.id}`}>
          {#snippet item(row)}
            <div class="space-y-1.5">
              <a
                href="/u/{row.user.handle}"
                class="flex min-w-0 items-center gap-1.5 text-xs hover:text-ink"
              >
                <Avatar person={row.user} size={20} />
                <span class="truncate font-semibold">{row.user.displayName}</span>
                {#if row.lastPlayedAt}
                  <span class="ml-auto shrink-0 text-muted">{formatRelative(row.lastPlayedAt)}</span
                  >
                {/if}
              </a>
              <GameCard
                game={row.game}
                progress={row}
                target={row.game.tier ?? 1}
                href="/jeux/{row.game.slug}?joueur={encodeURIComponent(row.user.handle)}"
              />
            </div>
          {/snippet}
        </GameRail>
      {:else}
        <p class="text-sm text-muted">{m.home_friends_playing_empty()}</p>
      {/if}
    </section>

    {#if data.home.almost.length}
      <section class="home-panel" aria-labelledby="presque">
        <h2 id="presque">{m.home_almost()}</h2>
        <GameRail items={data.home.almost} key={(row) => row.game.id}>
          {#snippet item(row)}
            <GameCard game={row.game} progress={row} target={row.game.tier ?? 1} />
          {/snippet}
        </GameRail>
      </section>
    {/if}

    {#if data.home.recent.length}
      <section class="home-panel" aria-labelledby="derniers">
        <h2 id="derniers">{m.home_recent()}</h2>
        <GameRail items={data.home.recent} key={(row) => row.game.id}>
          {#snippet item(row)}
            <GameCard game={row.game} progress={row} target={row.game.tier ?? 1} />
          {/snippet}
        </GameRail>
      </section>
    {/if}

    <div class="home-panel"><Podium collectors={data.podium} /></div>

    <StatGrid
      games={data.home.stats.games}
      unlocked={data.home.stats.unlocked}
      tiers={data.home.stats.tiers}
      points={data.home.stats.points}
    />
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

    <div class="home-panel"><LiveCards initial={data.cards} /></div>

    <div class="home-panel"><Podium collectors={data.podium} /></div>

    {#if data.popular?.length}
      <section class="home-panel">
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
