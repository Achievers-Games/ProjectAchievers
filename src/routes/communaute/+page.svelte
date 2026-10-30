<script lang="ts">
  import { fly } from 'svelte/transition';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import TrophyBadge from '$lib/components/TrophyBadge.svelte';
  import { formatNumber, formatRelative, plural } from '$lib/labels';

  let { data } = $props();

  interface LiveEvent {
    key: number;
    user: string;
    handle: string;
    avatarUrl: string | null;
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

  const periods = [
    { value: 'semaine', label: '7 jours' },
    { value: 'mois', label: '30 jours' },
    { value: 'tout', label: 'Tout' },
  ];
</script>

<svelte:head>
  <title>Communauté — Project Achievers</title>
  <meta name="description" content="Classement et derniers succès de la communauté." />
</svelte:head>

<div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
  <section class="min-w-0 space-y-3" aria-labelledby="activite">
    <h1 id="activite">Activité</h1>

    {#if live.length}
      <ul class="space-y-2" aria-live="polite">
        {#each live as event (event.key)}
          <li class="card flex items-center gap-3 p-3" in:fly={{ y: -8, duration: 150 }}>
            <Avatar name={event.user} src={event.avatarUrl} size={28} />
            <p class="min-w-0 text-sm">
              <a href="/u/{event.handle}" class="font-medium">{event.user}</a>
              a obtenu {plural(event.count, 'succès', 'succès')} sur
              <a href="/jeux/{event.gameSlug}" class="font-medium">{event.game}</a>
            </p>
          </li>
        {/each}
      </ul>
    {/if}

    {#if data.feed.length === 0}
      <Empty title="Aucune activité pour l'instant">
        Les succès des profils publics apparaîtront ici.
      </Empty>
    {:else}
      <ul class="card divide-y divide-line">
        {#each data.feed as item (`${item.user.handle}-${item.achievement.id}`)}
          <li class="flex items-center gap-3 p-3">
            <Avatar name={item.user.displayName} src={item.user.avatarUrl} size={28} />
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
      <h2 id="classement">Classement</h2>
      <div class="flex rounded border border-line text-xs" role="group" aria-label="Période">
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
      <Empty title="Classement vide sur cette période" />
    {:else}
      <ol class="card divide-y divide-line">
        {#each data.ranking as row, index (row.handle)}
          <li>
            <a
              href="/u/{row.handle}"
              class="flex items-center gap-3 p-3 transition-colors hover:bg-raised"
            >
              <span class="tabular w-5 text-right text-xs text-muted">{index + 1}</span>
              <Avatar name={row.displayName} src={row.avatarUrl} size={28} />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{row.displayName}</span>
              <span class="tabular text-sm">{formatNumber(row.points)}</span>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>
