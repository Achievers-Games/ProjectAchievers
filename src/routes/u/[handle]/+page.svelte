<script lang="ts">
  import { PLATFORM_LABELS } from '#lib/labels';
  import { subscribeJson } from '#lib/sse';
  import { enhance } from '$app/forms';
  import { submitWithToast } from '#lib/forms';
  import { m } from '#lib/paraglide/messages';
  import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
  import IdCard from '@lucide/svelte/icons/id-card';
  import Link from '@lucide/svelte/icons/link';
  import Avatar from '#lib/components/Avatar.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import GameCard from '#lib/components/GameCard.svelte';
  import ProviderIcon from '#lib/components/ProviderIcon.svelte';
  import TrophyBadge from '#lib/components/TrophyBadge.svelte';
  import StatGrid from '#lib/components/StatGrid.svelte';
  import { formatDate, formatNumber, formatRelative, PROVIDER_LABELS } from '#lib/labels';
  import { toast } from '#lib/stores/toast';
  import { SITE_TOTAL } from '#lib/site-achievements';

  let { data } = $props();
  const friendSubmit = submitWithToast();

  const profile = $derived(data.profile);
  let playing = $state<{ name: string; slug: string; platform?: 'PSN' | 'RETRO' } | null>(null);
  $effect(() => {
    const handle = profile.user.handle;
    playing = null;
    let stop: (() => void) | undefined;
    function updateSubscription() {
      stop?.();
      stop = undefined;
      if (document.hidden) return;
      playing = null;
      stop = subscribeJson<typeof playing>(
        `/u/${encodeURIComponent(handle)}/jeu-en-cours`,
        (game) => {
          playing = game;
        },
      );
    }
    updateSubscription();
    document.addEventListener('visibilitychange', updateSubscription);
    return () => {
      stop?.();
      document.removeEventListener('visibilitychange', updateSubscription);
    };
  });
  /** La grande image d'abord, l'en-tête du jeu derrière si elle n'existe pas. */
  const art = $derived(
    profile.background?.images.map((image) => `url("${encodeURI(image)}")`).join(', '),
  );
  const isMe = $derived(data.user?.id === profile.user.id);
  /** L'image de partage n'existe que pour un profil public : sinon, l'avatar seul. */
  const shareImage = $derived(
    profile.user.isPublic ? `/u/${profile.user.handle}/partage.png` : profile.user.avatarUrl,
  );

  /** Depuis un profil, une carte ouvre le jeu tel que ce joueur l'a fait : ses succès, son temps. */
  const gameHref = (card: { slug: string }) =>
    isMe ? undefined : `/jeux/${card.slug}?joueur=${profile.user.handle}`;
  const playedHours = $derived(Math.round(profile.stats.playtimeMinutes / 60));
  /** Steam est la seule source de temps de jeu : s'il le garde privé, il n'y a rien à additionner. */
  const playtimePrivate = $derived(
    playedHours === 0 && profile.user.accounts.some((account) => account.playtimeHidden),
  );
  /** Le lien de l'image, prêt à coller sur un forum, Lure ou un README. */
  async function shareCard() {
    // Le PNG s’affiche partout, Discord compris ; le SVG reste servi pour qui le préfère.
    const url = `${data.origin}/u/${profile.user.handle}/carte.png`;
    try {
      await navigator.clipboard.writeText(url);
      toast(m.player_card_copied());
    } catch {
      toast(url);
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(location.href);
      toast(m.share_copied());
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : on donne le lien à la main.
      toast(location.href);
    }
  }
</script>

<Seo
  title="{profile.user.displayName} — Project Achievers"
  description={m.profile_description({
    achievements: m.count_achievements({ count: profile.stats.unlocked }),
    cards: profile.stats.tiers.reduce((sum, count) => sum + count, 0),
  })}
  shareTitle={m.profile_og_title({ name: profile.user.displayName })}
  shareDescription={m.profile_og_description({
    achievements: m.count_achievements({ count: profile.stats.unlocked }),
    games: m.count_games({ count: profile.stats.games }),
  })}
  image={shareImage}
  imageSize={profile.user.isPublic
    ? {
        width: 1200,
        height: 630,
        alt: m.player_card_alt({ name: profile.user.displayName }),
      }
    : null}
  type="profile"
  jsonLd={{
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: profile.user.displayName,
      alternateName: profile.user.handle,
      ...(profile.user.avatarUrl ? { image: profile.user.avatarUrl } : {}),
    },
  }}
/>

{#if profile.background}
  <div class="profile-backdrop" style:--art={art} aria-hidden="true">
    {#if profile.background.kind === 'steam' && profile.background.motion}
      <!-- Un fond Steam animé : la vidéo couvre l'image fixe, coupée si l'on préfère moins
           d'animations. -->
      <video
        class="profile-backdrop-video"
        src={profile.background.motion}
        poster={profile.background.images[0]}
        autoplay
        muted
        loop
        playsinline
      ></video>
    {/if}
  </div>
{/if}

<div class="profile-page space-y-8" data-backdrop={profile.background ? '' : undefined}>
  <header class="profile-banner">
    {#if profile.background?.kind === 'game'}
      <a
        href={gameHref(profile.background) ?? `/jeux/${profile.background.slug}`}
        class="profile-banner-game"
        title={m.profile_banner_game({ game: profile.background.name })}
      >
        {profile.background.name}
      </a>
    {/if}
    <Avatar person={profile.user} play="always" size={112} />
    <div class="min-w-0">
      <h1>{profile.user.displayName}</h1>
      {#if playing}
        <a
          href="/jeux/{playing.slug}"
          class="inline-flex max-w-full items-center gap-2 text-sm text-ink hover:underline"
        >
          <Gamepad2 size={16} class="shrink-0" aria-hidden="true" />
          <span
            >{playing.platform === 'PSN'
              ? m.profile_playing_playstation({ game: playing.name })
              : playing.platform === 'RETRO'
                ? m.profile_playing_retro({ game: playing.name })
                : m.profile_playing_steam({ game: playing.name })}</span
          >
        </a>
      {/if}
      <p class="text-muted">
        {m.member_since({ date: formatDate(profile.user.createdAt) })}
        {#if playtimePrivate}
          · <span data-testid="profile-playtime">{m.playtime_private()}</span>
        {:else if playedHours > 0}
          · <span data-testid="profile-playtime"
            >{m.playtime_total({
              time: m.playtime_hours({ hours: formatNumber(playedHours) }),
            })}</span
          >
        {/if}
        {#if !profile.user.isPublic}· {m.private_profile()}{/if}
        {#if profile.user.clanMember}
          ·
          <a href="/clans/{profile.user.clanMember.clan.slug}" class="hover:text-ink">
            {profile.user.clanMember.clan.name}
          </a>
        {/if}
      </p>
      {#if profile.stats.playtimeByPlatform.length}
        <dl class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {#each profile.stats.playtimeByPlatform as row (row.platform)}
            <div class="flex gap-1">
              <dt>
                {PLATFORM_LABELS[row.platform as keyof typeof PLATFORM_LABELS] ?? row.platform}
              </dt>
              <dd class="tabular">
                {m.playtime_hours({ hours: formatNumber(Math.round(row.minutes / 60)) })}
              </dd>
            </div>
          {/each}
        </dl>
      {/if}
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
      {#if profile.user.isPublic}
        <button type="button" class="btn" onclick={shareCard}>
          <IdCard size={14} aria-hidden="true" />
          {m.player_card()}
        </button>
      {/if}
      {#if isMe}
        <a class="btn" href="/compte/fond">{m.background_title()}</a>
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

  <StatGrid
    games={profile.stats.games}
    unlocked={profile.stats.unlocked}
    tiers={profile.stats.tiers}
    points={profile.stats.points}
  />

  {#if profile.showcase.length}
    <section class="profile-panel space-y-3" aria-labelledby="vitrine">
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
            href={gameHref(card)}
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
      <section class="profile-panel space-y-3">
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
              target={card.target}
              copies={card.copies}
              next={card.next}
              href={gameHref(card)}
            />
          {/each}
        </div>
      </section>

      <section class="profile-panel space-y-3">
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
