<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Check from '@lucide/svelte/icons/check';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Flame from '@lucide/svelte/icons/flame';
  import Lock from '@lucide/svelte/icons/lock';
  import AchievementIcon from '$lib/components/AchievementIcon.svelte';
  import CompleteBadge from '$lib/components/CompleteBadge.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import TrophyBadge from '$lib/components/TrophyBadge.svelte';
  import { tilt } from '$lib/actions/tilt';
  import { submitWithToast } from '$lib/forms';
  import { formatDate, formatPercent, formatRarity, PLATFORM_LABELS, tierLabel } from '$lib/labels';
  import { getLocale } from '$lib/paraglide/runtime';
  import { isComplete } from '$lib/collection';

  let { data } = $props();

  type Filter = 'tous' | 'obtenus' | 'restants';
  const complete = $derived(isComplete(data.progress));
  const toggleHidden = submitWithToast({ reset: false });

  let filter = $state<Filter>('tous');
  let sort = $state<'rarete' | 'nom'>('rarete');

  const visible = $derived(
    data.achievements
      .filter((a) => {
        if (filter === 'obtenus') return a.unlockedAt;
        if (filter === 'restants') return !a.unlockedAt;
        return true;
      })
      .toSorted((a, b) =>
        sort === 'nom'
          ? a.name.localeCompare(b.name, getLocale())
          : (a.globalRarity ?? 101) - (b.globalRarity ?? 101),
      ),
  );

  const secrets = $derived(data.achievements.filter((a) => a.secret).length);

  const filters: { value: Filter; label: string }[] = [
    { value: 'tous', label: m.filter_all() },
    { value: 'obtenus', label: m.filter_unlocked() },
    { value: 'restants', label: m.filter_remaining() },
  ];
</script>

<svelte:head>
  <title>{data.game.name} — Project Achievers</title>
  <meta
    name="description"
    content={m.game_description({
      count: m.count_achievements({ count: data.achievements.length }),
      game: data.game.name,
    })}
  />
  <meta property="og:title" content={data.game.name} />
  {#if data.game.headerUrl}<meta property="og:image" content={data.game.headerUrl} />{/if}
</svelte:head>

<div class="space-y-6">
  <header class="flex flex-col gap-4 sm:flex-row">
    {#if data.game.headerUrl}
      <div
        use:tilt
        data-complete={complete || undefined}
        data-tier={complete ? data.tier : undefined}
        class="game-card relative w-full shrink-0 self-start overflow-hidden rounded-md sm:w-72"
      >
        <img src={data.game.headerUrl} alt="" class="w-full" />
        {#if complete}
          <span class="foil" aria-hidden="true"></span>
          <span class="absolute right-2 top-2"><CompleteBadge tier={data.tier} /></span>
        {/if}
      </div>
    {/if}
    <div class="min-w-0 flex-1 space-y-2">
      <h1>{data.game.name}</h1>
      <p class="text-sm text-muted">
        {PLATFORM_LABELS[data.game.platform]} · {m.count_achievements({
          count: data.achievements.length,
        })}
        · {m.count_players({ count: data.players })}
      </p>
      {#if data.versions.length}
        <p class="flex flex-wrap gap-2 text-sm">
          {#each data.versions as version (version.slug)}
            <a href="/jeux/{version.slug}" class="btn h-8">
              {m.version_of({ platform: PLATFORM_LABELS[version.platform] })}
              {#if version.completion !== null}· {formatPercent(version.completion)}{/if}
            </a>
          {/each}
        </p>
      {/if}
      {#if data.season}
        <a href="/saison" class="flex flex-wrap items-center gap-2 text-sm">
          {#if data.season.counts}
            <span class="season-badge"><Flame size={11} aria-hidden="true" /> {m.nav_season()}</span
            >
            {m.season_game_counts()}
          {:else if data.season.state === 'soon'}
            <span class="text-muted">
              {m.season_game_soon()}
            </span>
          {:else}
            <span class="text-muted">{m.season_game_no()}</span>
          {/if}
        </a>
      {/if}
      {#if data.progress}
        <form method="POST" action="?/hide" use:enhance={toggleHidden}>
          <input type="hidden" name="hidden" value={data.progress.hidden ? '0' : '1'} />
          <button class="btn h-8">
            {#if data.progress.hidden}
              <Eye size={14} aria-hidden="true" /> {m.game_unhide()}
            {:else}
              <EyeOff size={14} aria-hidden="true" /> {m.game_hide()}
            {/if}
          </button>
        </form>
        <div class="max-w-sm space-y-1 pt-2">
          {#if data.next}
            <Progress
              value={data.next.completion}
              tier={data.next.tier}
              base={data.tier}
              label={m.progress_toward({ tier: tierLabel(data.next.tier) })}
            />
            <p class="tabular text-sm text-muted">
              {m.next_tier({
                tier: tierLabel(data.next.tier),
                platform: PLATFORM_LABELS[data.next.platform],
                percent: Math.round(data.next.completion),
              })}
            </p>
          {/if}
          <Progress value={data.progress.completion} tier={complete ? data.tier : 0} />
          <p class="tabular text-sm text-muted">
            {data.progress.unlockedCount} / {data.progress.totalCount} · {formatPercent(
              data.progress.completion,
            )}
          </p>
        </div>
      {/if}
    </div>
  </header>

  <div class="flex flex-wrap items-center gap-2">
    <div class="flex rounded border border-line" role="group" aria-label={m.filter_achievements()}>
      {#each filters as item (item.value)}
        <button
          type="button"
          onclick={() => (filter = item.value)}
          aria-pressed={filter === item.value}
          class="px-3 py-1.5 text-sm transition-colors"
          class:bg-raised={filter === item.value}
          class:text-muted={filter !== item.value}
        >
          {item.label}
        </button>
      {/each}
    </div>
    {#if secrets}
      <a
        href={data.revealed ? '?' : '?caches=1'}
        rel="nofollow"
        data-sveltekit-noscroll
        class="btn h-9"
      >
        {#if data.revealed}
          <EyeOff size={14} aria-hidden="true" /> {m.achievements_conceal()}
        {:else}
          <Eye size={14} aria-hidden="true" />
          {m.achievements_reveal({ count: secrets })}
        {/if}
      </a>
    {/if}
    <select class="input ml-auto w-auto" aria-label={m.sort_achievements_label()} bind:value={sort}>
      <option value="rarete">{m.sort_rarest()}</option>
      <option value="nom">{m.sort_name()}</option>
    </select>
  </div>

  <ul class="card divide-y divide-line">
    {#each visible as achievement (achievement.id)}
      <li>
        <a
          href="/succes/{achievement.id}{data.revealed && achievement.secret ? '?caches=1' : ''}"
          data-unlocked={achievement.unlockedAt ? '' : undefined}
          class="achievement-row flex items-center gap-3 p-3 transition-colors hover:bg-raised"
        >
          <span class="relative shrink-0">
            {#if achievement.iconUrl}
              <AchievementIcon src={achievement.iconUrl} size={40} dim={!achievement.unlockedAt} />
            {:else}
              <span class="grid h-10 w-10 place-items-center rounded bg-raised text-muted">
                <Lock size={14} aria-hidden="true" />
              </span>
            {/if}
            {#if achievement.unlockedAt}
              <span class="achievement-check"><Check size={11} strokeWidth={3} /></span>
            {/if}
          </span>
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 text-sm font-medium">
              <span class="truncate" class:text-muted={data.user && !achievement.unlockedAt}>
                {achievement.name}
              </span>
              {#if achievement.secret && data.revealed}
                <EyeOff size={12} class="shrink-0 text-muted" aria-label={m.achievement_hidden()} />
              {/if}
            </p>
            <p class="truncate text-xs text-muted">{achievement.description}</p>
          </div>
          <div class="shrink-0 text-right">
            <TrophyBadge type={achievement.trophyType} />
            <p class="tabular text-xs text-muted">
              {#if achievement.unlockedAt}
                <span class="font-semibold text-success">{formatDate(achievement.unlockedAt)}</span>
              {:else if achievement.globalRarity !== null}
                {m.percent({ value: formatRarity(achievement.globalRarity) })}
              {/if}
            </p>
          </div>
        </a>
      </li>
    {/each}
  </ul>
</div>
