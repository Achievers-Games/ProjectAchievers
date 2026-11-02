<script lang="ts">
  import { enhance } from '$app/forms';
  import { submitWithToast } from '$lib/forms';
  import { m } from '$lib/paraglide/messages';
  import Link from '@lucide/svelte/icons/link';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import GameCard from '$lib/components/GameCard.svelte';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import TrophyBadge from '$lib/components/TrophyBadge.svelte';
  import {
    formatDate,
    formatNumber,
    formatRelative,
    PROVIDER_LABELS,
    tierLabel,
  } from '$lib/labels';
  import { toast } from '$lib/stores/toast';
  import { SITE_TOTAL } from '$lib/site-achievements';

  let { data } = $props();
  const friendSubmit = submitWithToast();

  const profile = $derived(data.profile);
  const isMe = $derived(data.user?.id === profile.user.id);
  const stats = $derived<{ label: string; value: number; tier?: number }[]>([
    { label: m.stat_games(), value: profile.stats.games },
    { label: m.stat_achievements(), value: profile.stats.unlocked },
    ...profile.stats.tiers.map((value, index) => ({
      label: tierLabel(index + 1),
      value,
      tier: index + 1,
    })),
    { label: m.stat_points(), value: profile.stats.points },
  ]);

  async function share() {
    await navigator.clipboard.writeText(location.href);
    toast(m.share_copied());
  }
</script>

<svelte:head>
  <title>{profile.user.displayName} — Project Achievers</title>
  <meta
    name="description"
    content={m.profile_description({
      achievements: m.count_achievements({ count: profile.stats.unlocked }),
      cards: profile.stats.tiers.reduce((sum, count) => sum + count, 0),
    })}
  />
  <meta property="og:title" content={m.profile_og_title({ name: profile.user.displayName })} />
  <meta
    property="og:description"
    content={m.profile_og_description({
      achievements: m.count_achievements({ count: profile.stats.unlocked }),
      games: m.count_games({ count: profile.stats.games }),
    })}
  />
  {#if profile.user.avatarUrl}<meta property="og:image" content={profile.user.avatarUrl} />{/if}
</svelte:head>

<div class="space-y-8">
  <header class="flex flex-wrap items-center gap-4">
    <Avatar person={profile.user} play="always" size={112} />
    <div class="min-w-0">
      <h1>{profile.user.displayName}</h1>
      <p class="text-muted">
        {m.member_since({ date: formatDate(profile.user.createdAt) })}
        {#if !profile.user.isPublic}· {m.private_profile()}{/if}
        {#if profile.user.clanMember}
          ·
          <a href="/clans/{profile.user.clanMember.clan.slug}" class="hover:text-ink">
            {profile.user.clanMember.clan.name}
          </a>
        {/if}
      </p>
      <ul class="mt-1 flex gap-3 text-muted">
        {#each profile.user.accounts as account (account.provider)}
          <li>
            <a
              href={account.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-ink"
              aria-label="{PROVIDER_LABELS[account.provider]} : {account.displayName}"
            >
              <ProviderIcon provider={account.provider} />
            </a>
          </li>
        {/each}
      </ul>
    </div>
    <div class="ml-auto flex flex-wrap justify-end gap-2">
      <a class="btn" href="/u/{profile.user.handle}/succes">
        {m.ach_profile_link({ count: data.siteAchievements, total: SITE_TOTAL })}
      </a>
      <button type="button" class="btn" onclick={share}>
        <Link size={14} aria-hidden="true" />
        {m.share()}
      </button>
      {#if isMe}
        <a class="btn btn-primary" href="/compte">{m.profile_edit()}</a>
      {/if}
      {#if data.relation === 'none'}
        <form method="POST" action="/amis?/add" use:enhance={friendSubmit}>
          <input type="hidden" name="handle" value={profile.user.handle} />
          <button class="btn btn-primary">{m.friend_add()}</button>
        </form>
      {:else if data.relation === 'friends'}
        <form method="POST" action="/amis?/message" use:enhance>
          <input type="hidden" name="id" value={profile.user.id} />
          <button class="btn btn-primary">{m.friend_message()}</button>
        </form>
      {:else if data.relation === 'sent' || data.relation === 'received'}
        <a class="btn" href="/amis">{m.friends_pending()}</a>
      {/if}
      {#if data.user && !isMe}
        <a class="btn" href="/comparer?a={data.user.handle}&b={profile.user.handle}"
          >{m.compare()}</a
        >
      {/if}
    </div>
  </header>

  <dl class="card grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-9 sm:divide-x sm:divide-line">
    {#each stats as stat (stat.label)}
      <div class="p-4">
        <dt class="label">{stat.label}</dt>
        <dd class="stat-value tabular mt-1" data-tier={stat.tier}>
          {formatNumber(stat.value)}
        </dd>
      </div>
    {/each}
  </dl>

  {#if profile.showcase.length}
    <section class="space-y-3" aria-labelledby="vitrine">
      <div class="flex items-baseline justify-between gap-4">
        <h2 id="vitrine">{m.showcase_title()}</h2>
        {#if isMe}
          <a href="/compte/vitrine" class="text-sm text-muted hover:text-ink">
            {m.showcase_edit()}
          </a>
        {/if}
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {#each profile.showcase as card (card.id)}
          <GameCard
            game={card}
            progress={card.progress}
            versions={card.versions}
            tier={card.tier}
            copies={card.copies}
            next={card.next}
            live
          />
        {/each}
      </div>
    </section>
  {/if}

  {#if profile.games.length === 0}
    <Empty title={m.profile_empty()}>
      {isMe ? m.profile_empty_mine() : m.profile_empty_other()}
      {#snippet action()}
        {#if isMe}<a href="/compte" class="btn btn-primary">{m.link_account()}</a>{/if}
      {/snippet}
    </Empty>
  {:else}
    <div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section class="space-y-3">
        <div class="flex items-baseline justify-between gap-4">
          <h2>{m.stat_games()}</h2>
          <a
            href="/jeux?joueur={profile.user.handle}&tri=progression"
            class="text-sm text-muted hover:text-ink"
          >
            {m.games_see_all({ count: profile.stats.games })}
          </a>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each profile.games as card (card.id)}
            <GameCard
              game={card}
              progress={card.progress}
              versions={card.versions}
              tier={card.tier}
              copies={card.copies}
              next={card.next}
            />
          {/each}
        </div>
      </section>

      <section class="space-y-3">
        <h2>{m.recent_achievements()}</h2>
        <ul class="card divide-y divide-line">
          {#each profile.recent as item (item.achievement.id)}
            <li>
              <a
                href="/succes/{item.achievement.id}"
                class="block p-3 transition-colors hover:bg-raised"
              >
                <p class="truncate text-sm font-medium">{item.achievement.name}</p>
                <p class="flex justify-between gap-2 text-xs text-muted">
                  <span class="truncate">{item.achievement.game.name}</span>
                  <span class="shrink-0">{formatRelative(item.unlockedAt)}</span>
                </p>
                <TrophyBadge type={item.achievement.trophyType} />
              </a>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</div>
