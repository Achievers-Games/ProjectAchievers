<script lang="ts">
  import { untrack } from 'svelte';
  import PageBackdrop from '#lib/components/PageBackdrop.svelte';
  import { m } from '#lib/paraglide/messages';
  import Seo from '#lib/components/Seo.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import Lock from '@lucide/svelte/icons/lock';
  import ActivityReactions from '#lib/components/ActivityReactions.svelte';
  import { dragScroll } from '#lib/actions/drag-scroll';
  import { unlockHref } from '#lib/activity';
  import AchievementIcon from '#lib/components/AchievementIcon.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import Avatar from '#lib/components/Avatar.svelte';
  import GameCard from '#lib/components/GameCard.svelte';
  import GameRail from '#lib/components/GameRail.svelte';
  import { formatRarity, formatRelative } from '#lib/labels';
  import HomeCarousel from '#lib/components/HomeCarousel.svelte';
  import HomeGuides from '#lib/components/HomeGuides.svelte';
  import LiveCards from '#lib/components/LiveCards.svelte';
  import MissingPlatforms from '#lib/components/MissingPlatforms.svelte';
  import Podium from '#lib/components/Podium.svelte';
  import ProviderIcon from '#lib/components/ProviderIcon.svelte';
  import StatGrid from '#lib/components/StatGrid.svelte';
  import SteamReviewBanner from '#lib/components/SteamReviewBanner.svelte';
  import UnlockDiscussion from '#lib/components/UnlockDiscussion.svelte';

  let { data } = $props();
  /**
   * Tiré une fois par visite : une synchronisation recharge les données de la page, et le fond
   * ne doit pas changer sous les yeux du joueur.
   */
  const backdrop = untrack(() => data.backdrop);
  let unlockDialog = $state<HTMLDialogElement>();
  const threadQuery = $derived(
    data.thread ? unlockQuery(data.thread.user.handle, data.thread.achievementId) : '',
  );

  function unlockQuery(handle: string, id: string) {
    return `ami=${encodeURIComponent(handle)}&deblocage=${encodeURIComponent(id)}`;
  }

  function openUnlock(event: MouseEvent, handle: string, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    void goto(`/?${unlockQuery(handle, id)}`, { replace: true, reset: false });
  }

  $effect(() => {
    if (data.thread && unlockDialog?.isConnected && !unlockDialog.open) unlockDialog.showModal();
  });
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

{#if backdrop}
  <PageBackdrop images={backdrop.images} fit={backdrop.cover ? 'cover' : 'band'} soft />
{/if}

{#if data.home && data.user}
  <div class="space-y-8">
    <h1>{m.home_hello({ name: data.user.displayName })}</h1>

    <SteamReviewBanner reviews={data.steamReviews} />

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

    <div class="home-panel"><LiveCards initial={data.cards} signedIn /></div>

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

    <section class="home-panel space-y-3" aria-labelledby="amis-succes">
      <h2 id="amis-succes">{m.home_friend_unlocks()}</h2>
      {#if data.unlocks.length}
        <ul class="live-rail" use:dragScroll>
          {#each data.unlocks as row (`${row.user.handle}/${row.achievementId}`)}
            <li class="unlock-item">
              <a
                href={unlockHref(row.user.handle, row.achievementId)}
                onclick={(event) => openUnlock(event, row.user.handle, row.achievementId)}
                class="unlock-tile"
              >
                <span class="flex items-center gap-1.5">
                  <Avatar person={row.user} size={18} />
                  <span class="truncate text-xs font-semibold">{row.user.displayName}</span>
                  <span class="ml-auto shrink-0 text-xs text-muted"
                    >{formatRelative(row.unlockedAt)}</span
                  >
                </span>
                <span class="flex items-center gap-2">
                  {#if row.iconUrl}
                    <AchievementIcon src={row.iconUrl} size={40} />
                  {:else}
                    <span class="unlock-secret" aria-hidden="true"><Lock size={16} /></span>
                  {/if}
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold"
                      >{row.name ?? m.achievement_hidden()}</span
                    >
                    <span class="block truncate text-xs text-muted">{row.game.name}</span>
                  </span>
                </span>
                {#if row.rarity != null}
                  <span class="tabular text-xs text-muted"
                    >{m.achievement_rarity({ value: formatRarity(row.rarity) })}</span
                  >
                {/if}
              </a>
              <div class="mt-1 flex items-center gap-2 px-1">
                <ActivityReactions
                  kind="unlock"
                  handle={row.user.handle}
                  id={row.achievementId}
                  summary={row.reactions}
                  signedIn
                />
                <a
                  href={unlockHref(row.user.handle, row.achievementId)}
                  onclick={(event) => openUnlock(event, row.user.handle, row.achievementId)}
                  class="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-raised hover:text-ink"
                  aria-label={m.unlock_comments({ count: row.count })}
                >
                  <MessageCircle size={14} aria-hidden="true" />
                  {row.count}
                </a>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-muted">{m.home_friend_unlocks_empty()}</p>
      {/if}
    </section>

    {#if data.thread}
      <dialog
        bind:this={unlockDialog}
        aria-labelledby="unlock-dialog-title"
        onclose={() => void goto('/', { replace: true, reset: false })}
        class="card fixed inset-0 m-auto max-h-[85dvh] w-[min(42rem,calc(100%-1rem))] overflow-auto p-4 backdrop:bg-black/70"
      >
        <form method="dialog" class="mb-2 flex justify-end">
          <button class="btn">{m.reveal_close()}</button>
        </form>
        {#key threadQuery}
          <UnlockDiscussion thread={data.thread} actionQuery={threadQuery} modal />
        {/key}
      </dialog>
    {/if}

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

    <div class="home-panel">
      <HomeGuides official={data.guides.official} community={data.guides.community} />
    </div>

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

    <div class="home-panel">
      <HomeGuides official={data.guides.official} community={data.guides.community} />
    </div>

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
