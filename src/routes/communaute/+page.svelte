<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { fly } from 'svelte/transition';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import TrophyBadge from '$lib/components/TrophyBadge.svelte';
  import { formatNumber, formatRelative } from '$lib/labels';

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

  let live = $state<LiveEvent[]>([]);
  let nextKey = 0;

  $effect(() => {
    const source = new EventSource('/api/activite');
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as Omit<LiveEvent, 'key'>;
      live = [{ ...event, key: nextKey++ }, ...live].slice(0, 10);
    };
    return () => source.close();
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
    <h1 id="activite">{m.activity()}</h1>

    {#if live.length}
      <ul class="space-y-2" aria-live="polite">
        {#each live as event (event.key)}
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

    {#if data.feed.length === 0}
      <Empty title={m.activity_empty()}>{m.activity_empty_text()}</Empty>
    {:else}
      <ul class="card divide-y divide-line">
        {#each data.feed as item (`${item.user.handle}-${item.achievement.id}`)}
          <li class="flex items-center gap-3 p-3">
            <Avatar
              name={item.user.displayName}
              src={item.user.avatarUrl}
              frame={item.user.frame}
              motion={item.user.avatarMotionUrl}
              frameMotion={item.user.frameMotionUrl}
              size={28}
            />
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
      <h2 id="classement"><a href="/classement" class="hover:text-accent">{m.ranking()}</a></h2>
      <div class="flex rounded border border-line text-xs" role="group" aria-label={m.period()}>
        {#each periods as period (period.value)}
          <a
            href="?periode={period.value}"
            data-sveltekit-noscroll
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
              <Avatar
                name={row.displayName}
                src={row.avatarUrl}
                frame={row.frame}
                motion={row.avatarMotionUrl}
                frameMotion={row.frameMotionUrl}
                size={28}
              />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{row.displayName}</span>
              <span class="tabular text-sm">{formatNumber(row.unlocked)}</span>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>
