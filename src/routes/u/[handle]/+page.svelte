<script lang="ts">
  import { unlockHref } from '#lib/activity';
  import { subscribeJson } from '#lib/sse';
  import { enhance } from '$app/forms';
  import { submitWithToast } from '#lib/forms';
  import { m } from '#lib/paraglide/messages';
  import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
  import Trophy from '@lucide/svelte/icons/trophy';
  import Scale from '@lucide/svelte/icons/scale';
  import Palette from '@lucide/svelte/icons/palette';
  import Avatar from '#lib/components/Avatar.svelte';
  import Discussion from '#lib/components/Discussion.svelte';
  import ProfileShare from '#lib/components/ProfileShare.svelte';
  import ProfileCardArt from '#lib/components/ProfileCardArt.svelte';
  import CardInspection from '#lib/components/CardInspection.svelte';
  import PlaytimeBreakdown, { type PlaytimeLine } from '#lib/components/PlaytimeBreakdown.svelte';
  import PageBackdrop from '#lib/components/PageBackdrop.svelte';
  import { cssArt } from '#lib/art';
  import Empty from '#lib/components/Empty.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import GameCard from '#lib/components/GameCard.svelte';
  import ProviderIcon from '#lib/components/ProviderIcon.svelte';
  import RarityBadge from '#lib/components/RarityBadge.svelte';
  import StatGrid from '#lib/components/StatGrid.svelte';
  import { formatDate, formatNumber, formatRelative, PROVIDER_LABELS } from '#lib/labels';
  import { SITE_TOTAL } from '#lib/site-achievements';

  let { data } = $props();
  let inspectBanner = $state(false);
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
  const bannerArt = $derived(
    data.cardBanner?.game.headerUrl
      ? cssArt([data.cardBanner.game.headerUrl])
      : profile.banner
        ? cssArt(profile.banner.images)
        : undefined,
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
  /**
   * Le temps de jeu rangé sous le compte qui l'a compté, une ligne par plateforme : PS4 et PS5
   * tiennent toutes deux au compte PlayStation, chacune sur sa ligne. Moins d'une heure ne
   * s'affiche pas.
   */
  const accountRows = $derived(
    profile.user.accounts.map((account) => ({
      account,
      rows: profile.stats.playtimeByPlatform.filter(
        (row) =>
          row.minutes >= 30 &&
          (account.provider === 'PSN'
            ? ['PSN', 'PS4', 'PS5'].includes(row.platform)
            : row.platform === account.provider),
      ),
    })),
  );
  const playtimeLines = $derived<PlaytimeLine[]>(
    accountRows.flatMap(({ account, rows }) =>
      rows.map((row) => ({
        key: row.platform,
        provider: account.provider,
        console: row.platform === 'PS4' || row.platform === 'PS5' ? row.platform : null,
        hours: m.playtime_short({ hours: formatNumber(Math.round(row.minutes / 60)) }),
        href: account.profileUrl,
        name: `${PROVIDER_LABELS[account.provider]} : ${account.displayName}`,
      })),
    ),
  );
  /** Steam est la seule source de temps de jeu : s'il le garde privé, il n'y a rien à additionner. */
  const playtimePrivate = $derived(
    playedHours === 0 && profile.user.accounts.some((account) => account.playtimeHidden),
  );
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
  breadcrumbs={[
    { name: m.nav_community(), path: '/communaute' },
    { name: profile.user.displayName, path: `/u/${profile.user.handle}` },
  ]}
/>

{#if profile.background}
  <PageBackdrop
    images={profile.background.images}
    motion={profile.background.kind === 'steam' ? profile.background.motion : null}
    fit={profile.background.kind === 'steam' || profile.background.cover ? 'cover' : 'band'}
  />
{/if}

<div class="profile-page space-y-8" data-backdrop={profile.background ? '' : undefined}>
  <header
    class="profile-banner isolate"
    style:--art={bannerArt}
    data-art={data.cardBanner || profile.banner ? '' : undefined}
    data-card-banner={data.cardBanner ? '' : undefined}
  >
    {#if data.cardBanner}
      {#key data.cardBanner.assetPath}
        <ProfileCardArt assetPath={data.cardBanner.assetPath} kind={data.cardBanner.kind} />
      {/key}
      <button
        type="button"
        class="profile-banner-game"
        aria-label={m.booster_inspect({ name: data.cardBanner.game.name })}
        aria-haspopup="dialog"
        onclick={() => (inspectBanner = true)}>{data.cardBanner.game.name}</button
      >
    {:else if profile.banner?.kind === 'game'}
      <a
        href={gameHref(profile.banner) ?? `/jeux/${profile.banner.slug}`}
        class="profile-banner-game"
        title={m.profile_banner_game({ game: profile.banner.name })}
      >
        {profile.banner.name}
      </a>
    {/if}
    <Avatar person={profile.user} play="always" size={112} />
    <div class="min-w-0">
      <!-- Les succès du site à côté du nom : ce que le joueur regarde en premier sur un profil. -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1>{profile.user.displayName}</h1>
        <a class="profile-ach-link" href="/u/{profile.user.handle}/succes">
          <Trophy size={16} aria-hidden="true" />
          {m.ach_profile_link({ count: data.siteAchievements, total: SITE_TOTAL })}
        </a>
      </div>
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
        {#if !profile.user.isPublic}· {m.private_profile()}{/if}
        {#if profile.user.clanMember}
          ·
          <a href="/clans/{profile.user.clanMember.clan.slug}" class="hover:text-ink">
            {profile.user.clanMember.clan.name}
          </a>
        {/if}
      </p>
      <!-- Le total seul ; son détail par plateforme s'ouvre au survol ou d'un clic. -->
      {#if playtimePrivate}
        <p class="text-sm text-muted" data-testid="profile-playtime">{m.playtime_private()}</p>
      {:else if playedHours > 0}
        <PlaytimeBreakdown
          total={m.playtime_overall({ hours: formatNumber(playedHours) })}
          lines={playtimeLines}
        />
      {/if}
      <!-- Les comptes, toujours là : chaque icône mène au profil sur sa plateforme. -->
      <ul class="mt-1 flex flex-wrap items-center gap-3 text-muted">
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
    <!-- Les réglages ou la comparaison, le partage en icônes, l'action principale à droite. -->
    <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
      {#if data.user && !isMe}
        <a class="btn" href="/comparer?a={data.user.handle}&b={profile.user.handle}">
          <Scale size={14} aria-hidden="true" />
          {m.compare()}
        </a>
      {/if}
      {#if isMe}
        <a class="btn" href="/compte/fond">
          <Palette size={14} aria-hidden="true" />
          {m.appearance_title()}
        </a>
      {/if}
      <ProfileShare
        handle={profile.user.handle}
        origin={data.origin}
        isPublic={profile.user.isPublic}
      />
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
    </div>
  </header>
  {#if inspectBanner && data.cardBanner}
    {@const banner = data.cardBanner}
    <CardInspection card={banner} position={1} total={1} onclose={() => (inspectBanner = false)}>
      {#snippet actions()}
        <a class="btn" href={gameHref(banner.game) ?? `/jeux/${banner.game.slug}`}>
          {m.collection_banner_game_page()}
        </a>
      {/snippet}
    </CardInspection>
  {/if}

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
                <RarityBadge rarity={item.achievement.globalRarity} />
              </a>
              {#if data.relation === 'friends' || data.relation === 'self'}
                <a
                  href={unlockHref(profile.user.handle, item.achievement.id)}
                  class="mb-2 ml-3 inline-block rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
                >
                  {m.unlock_discussion()}
                </a>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
  {#if data.comments}
    <div id="discussion" class="profile-panel scroll-mt-24">
      <Discussion
        comments={data.comments}
        signedIn={Boolean(data.user)}
        signInHref="/connexion?retour=/u/{profile.user.handle}"
        canTranslate={data.canTranslate}
      />
    </div>
  {/if}
</div>
