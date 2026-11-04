<script lang="ts">
  import { HOLO_TIER } from '#lib/collection';
  import { m } from '#lib/paraglide/messages';
  import { invalidate } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import Avatar from '#lib/components/Avatar.svelte';
  import CompleteBadge from '#lib/components/CompleteBadge.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import SocialNav from '#lib/components/SocialNav.svelte';
  import TrophyBadge from '#lib/components/TrophyBadge.svelte';
  import { formatNumber, formatRelative, tierLabel } from '#lib/labels';
  import { subscribeJson } from '#lib/sse';

  let { data } = $props();

  interface LiveEvent {
    key: number;
    user: string;
    handle: string;
    avatarUrl: string | null;
    avatarMotionUrl: string | null;
    frame: string | null;
    frameMotionUrl: string | null;
    game: string;
    gameSlug: string;
    count: number;
  }

  const RELOAD_DELAY = 1_500;

  /** Plus la carte est rare, plus elle prend de place. */
  const MOMENT_AVATAR: Record<number, number> = { 2: 36, 3: 48, 4: 64 };
  /** Un moment grandit avec le niveau de la carte, ou avec ses exemplaires. */
  const momentSize = ({ tier, copies }: { tier: number; copies: number }) =>
    Math.max(tier - 2, copies, 1);

  let live = $state<LiveEvent[]>([]);
  let nextKey = 0;

  // Le global ne suit pas chaque succès : seuls les proches arrivent ici en direct.
  const shownLive = $derived(live.filter((event) => data.circle.includes(event.handle)));

  const rankingTitle = $derived(
    data.tab === 'amis'
      ? m.ranking_friends()
      : data.tab === 'clan'
        ? m.ranking_clan()
        : m.ranking(),
  );

  const tabs = [
    { value: 'amis', label: m.nav_friends() },
    { value: 'clan', label: m.nav_clan() },
    { value: 'global', label: m.activity_global() },
  ];

  // Seul l'onglet compte ici : une mise à jour des données ne doit pas rouvrir les flux.
  const tab = $derived(data.tab);

  // Plusieurs événements peuvent arriver ensemble : la page ne se recharge qu'une fois.
  $effect(() => {
    if (tab !== 'global') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource('/api/global');
    source.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void invalidate('app:communaute'), RELOAD_DELAY);
    };
    return () => {
      clearTimeout(timer);
      source.close();
    };
  });

  $effect(() => {
    if (tab === 'global') return;
    return subscribeJson<Omit<LiveEvent, 'key'>>('/api/activite', (event) => {
      live = [{ ...event, key: nextKey++ }, ...live].slice(0, 10);
    });
  });

  /** Les liens gardent la place que chaque langue leur donne dans la phrase. */
  const USER = '';
  const GAME = '';
  const liveParts = (event: LiveEvent) =>
    m
      .activity_live({
        user: USER,
        game: GAME,
        count: m.count_achievements({ count: event.count }),
      })
      .split(/(|)/);

  const periods = [
    { value: 'semaine', label: m.period_week() },
    { value: 'mois', label: m.period_month() },
    { value: 'tout', label: m.period_all() },
  ];
</script>

<svelte:head>
  <title>{m.nav_community()} — Project Achievers</title>
  <meta name="description" content={m.community_description()} />
</svelte:head>

<div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
  <section class="min-w-0 space-y-3" aria-labelledby="activite">
    <h1 id="activite">{m.nav_community()}</h1>
    {#if data.user}
      <SocialNav />
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex rounded border border-line text-sm" role="group" aria-label={m.activity()}>
          {#each tabs as tab (tab.value)}
            <a
              href="?onglet={tab.value}&periode={data.period}"
              data-sveltekit-reset="false"
              aria-current={data.tab === tab.value ? 'true' : undefined}
              class="px-3 py-1.5"
              class:bg-raised={data.tab === tab.value}
              class:text-muted={data.tab !== tab.value}
            >
              {tab.label}
            </a>
          {/each}
        </div>
      </div>
    {/if}
    <a href="/clans" class="block text-sm text-muted hover:text-ink">{m.clans_all()}</a>

    {#if shownLive.length}
      <ul class="space-y-2" aria-live="polite">
        {#each shownLive as event (event.key)}
          <li class="card flex items-center gap-3 p-3" in:fly={{ y: -8, duration: 150 }}>
            <Avatar
              name={event.user}
              src={event.avatarUrl}
              frame={event.frame}
              motion={event.avatarMotionUrl}
              frameMotion={event.frameMotionUrl}
              size={28}
            />
            <p class="min-w-0 text-sm">
              {#each liveParts(event) as part, index (index)}
                {#if part === USER}
                  <a href="/u/{event.handle}" class="font-medium">{event.user}</a>
                {:else if part === GAME}
                  <a href="/jeux/{event.gameSlug}" class="font-medium">{event.game}</a>
                {:else}
                  {part}
                {/if}
              {/each}
            </p>
          </li>
        {/each}
      </ul>
    {/if}

    {#if data.tab === 'global'}
      {#if data.moments.length === 0}
        <Empty title={m.activity_empty()}>{m.activity_empty_global()}</Empty>
      {:else}
        <ul class="space-y-2">
          {#each data.moments as item (item.key)}
            {#if item.kind === 'card'}
              <li in:fly={{ y: -12, duration: 250 }}>
                <a
                  href="/jeux/{item.game.slug}"
                  data-complete={momentSize(item) > 1 || undefined}
                  data-tier={momentSize(item) > 1 ? item.tier : undefined}
                  data-copies={item.copies > 1 ? item.copies : undefined}
                  class="moment game-card card"
                  class:moment-big={momentSize(item) > 1}
                  style:--moment-image={momentSize(item) > 1 && item.game.headerUrl
                    ? `url("${item.game.headerUrl}")`
                    : undefined}
                  data-size={momentSize(item)}
                >
                  <Avatar
                    person={item.user}
                    size={MOMENT_AVATAR[momentSize(item)] ?? 28}
                    play="always"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="moment-title block truncate">
                      {item.user.displayName} — {item.game.name}
                    </span>
                    <span class="block text-xs">
                      {m.activity_tier({ tier: tierLabel(item.tier) })} · {formatRelative(item.at)}
                    </span>
                  </span>
                  <CompleteBadge tier={item.tier} copies={item.copies} />
                  {#if item.tier >= HOLO_TIER}<span class="foil" aria-hidden="true"></span>{/if}
                </a>
              </li>
            {:else}
              <li class="card flex items-center gap-3 p-3" in:fly={{ y: -12, duration: 250 }}>
                <Avatar person={item.user} size={28} />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm">
                    <a href="/u/{item.user.handle}" class="font-medium">{item.user.displayName}</a>
                    —
                    <a href="/succes/{item.achievement.id}">{item.achievement.name}</a>
                  </p>
                  <p class="truncate text-xs text-muted">{item.achievement.game.name}</p>
                </div>
                <div class="shrink-0 text-right">
                  <TrophyBadge type={item.achievement.trophyType} />
                  <p class="text-xs text-muted">{formatRelative(item.at)}</p>
                </div>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    {:else if data.feed.length === 0}
      <Empty title={m.activity_empty()}>
        {data.tab === 'amis' ? m.activity_empty_friends() : m.activity_empty_clan()}
      </Empty>
    {:else}
      <ul class="card divide-y divide-line">
        {#each data.feed as item (`${item.user.handle}-${item.achievement.id}`)}
          <li class="flex items-center gap-3 p-3">
            <Avatar person={item.user} size={28} />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">
                <a href="/u/{item.user.handle}" class="font-medium">{item.user.displayName}</a>
                —
                <a href="/succes/{item.achievement.id}">{item.achievement.name}</a>
              </p>
              <p class="truncate text-xs text-muted">{item.achievement.game.name}</p>
            </div>
            <div class="shrink-0 text-right">
              <TrophyBadge type={item.achievement.trophyType} />
              <p class="text-xs text-muted">{formatRelative(item.unlockedAt)}</p>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="min-w-0 space-y-3" aria-labelledby="classement">
    <div class="flex items-center justify-between gap-2">
      <h2 id="classement"><a href="/classement" class="hover:text-accent">{rankingTitle}</a></h2>
      <div class="flex rounded border border-line text-xs" role="group" aria-label={m.period()}>
        {#each periods as period (period.value)}
          <a
            href="?onglet={data.tab}&periode={period.value}"
            data-sveltekit-reset="false"
            aria-current={data.period === period.value ? 'true' : undefined}
            class="px-2 py-1"
            class:bg-raised={data.period === period.value}
            class:text-muted={data.period !== period.value}
          >
            {period.label}
          </a>
        {/each}
      </div>
    </div>

    {#if data.ranking.length === 0}
      <Empty title={m.ranking_empty()} />
    {:else}
      <ol class="card divide-y divide-line">
        {#each data.ranking as row, index (row.handle)}
          <li>
            <a
              href="/u/{row.handle}"
              class="flex items-center gap-3 p-3 transition-colors hover:bg-raised"
            >
              <span class="tabular w-5 text-right text-xs text-muted">{index + 1}</span>
              <Avatar person={row} size={28} />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{row.displayName}</span>
              <span class="tabular text-sm">{formatNumber(row.unlocked)}</span>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>
