<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Check from '@lucide/svelte/icons/check';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Flame from '@lucide/svelte/icons/flame';
  import Lock from '@lucide/svelte/icons/lock';
  import Minus from '@lucide/svelte/icons/minus';
  import Users from '@lucide/svelte/icons/users';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import AchievementIcon from '#lib/components/AchievementIcon.svelte';
  import CompleteBadge from '#lib/components/CompleteBadge.svelte';
  import Progress from '#lib/components/Progress.svelte';
  import TrophyBadge from '#lib/components/TrophyBadge.svelte';
  import { tilt } from '#lib/actions/tilt';
  import { submitWithToast } from '#lib/forms';
  import { HOLO_TIER } from '#lib/collection';
  import CardFx from '#lib/components/CardFx.svelte';
  import { editionLabel, formatDate, formatPercent, formatRarity } from '#lib/labels';
  import { getLocale } from '#lib/paraglide/runtime';
  import { isComplete } from '#lib/collection';
  import { compareBucket } from '#lib/compare';

  let { data } = $props();

  type Filter = 'tous' | 'obtenus' | 'restants' | 'manquables' | 'commun' | 'moi' | 'lui';
  const complete = $derived(isComplete(data.progress));
  const toggleHidden = submitWithToast({ reset: false });

  /** La comparaison ne se déroule que si les deux possèdent cette version précise. */
  const comparing = $derived(Boolean(data.compare?.progress && data.progress));
  const theirUnlocks = $derived(new Set(data.compare?.visible ?? []));
  const withHandle = $derived(data.compare?.user.handle ?? null);

  let filter = $state<Filter>('tous');
  let sort = $state<'rarete' | 'nom'>('rarete');

  const visible = $derived(
    data.achievements
      .filter((a) => {
        if (comparing) {
          const bucket = compareBucket(a, theirUnlocks);
          if (filter === 'commun') return bucket === 'common';
          if (filter === 'moi') return bucket === 'mine';
          if (filter === 'lui') return bucket === 'theirs';
          return true;
        }
        if (filter === 'obtenus') return a.unlockedAt;
        if (filter === 'restants') return !a.unlockedAt;
        if (filter === 'manquables') return a.missable;
        return true;
      })
      .toSorted((a, b) =>
        sort === 'nom'
          ? a.name.localeCompare(b.name, getLocale())
          : (a.globalRarity ?? 101) - (b.globalRarity ?? 101),
      ),
  );

  /** Les paramètres de la page voyagent ensemble : révéler les succès cachés garde `avec`. */
  function gameHref(slug: string, options: { avec?: string | null; caches?: boolean } = {}) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- copie locale, jamais observée
    const search = new URLSearchParams();
    if (options.avec) search.set('avec', options.avec);
    if (options.caches) search.set('caches', '1');
    const query = search.toString();
    return `/jeux/${slug}${query ? `?${query}` : ''}`;
  }

  /** L'état de l'autre sur une ligne : `masked` reste neutre, même s'il l'a débloqué. */
  const theirState = (achievement: (typeof data.achievements)[number]) =>
    achievement.masked
      ? 'masked'
      : compareBucket(achievement, theirUnlocks) === 'common' ||
          compareBucket(achievement, theirUnlocks) === 'theirs'
        ? 'yes'
        : 'no';

  /** World of Warcraft dépasse 8 000 succès : le navigateur n'en dessine pas tant d'un coup. */
  const PAGE = 300;
  let shown = $state(PAGE);
  let view = $state('');

  const secrets = $derived(data.achievements.filter((a) => a.secret).length);

  const filters: { value: Filter; label: string }[] = $derived(
    comparing
      ? [
          { value: 'tous', label: m.filter_all() },
          { value: 'commun', label: m.compare_filter_common() },
          { value: 'moi', label: m.compare_filter_mine() },
          {
            value: 'lui',
            label: m.compare_filter_theirs({ name: data.compare?.user.displayName ?? '' }),
          },
        ]
      : [
          { value: 'tous', label: m.filter_all() },
          { value: 'obtenus', label: m.filter_unlocked() },
          { value: 'restants', label: m.filter_remaining() },
          ...(data.achievements.some((a) => a.missable)
            ? [{ value: 'manquables' as const, label: m.filter_missable() }]
            : []),
        ],
  );

  // Changer de mode, de filtre ou de tri repart du début de la liste. Quitter la comparaison
  // laisse un filtre qui n'existe plus : il revient à « tous ».
  $effect(() => {
    if (!filters.some((item) => item.value === filter)) {
      filter = 'tous';
      return;
    }
    const next = `${comparing}|${filter}|${sort}`;
    if (next === view) return;
    view = next;
    shown = PAGE;
  });

  const missingMissables = $derived(
    data.achievements.filter((a) => a.missable && !a.unlockedAt).length,
  );
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
  <!-- `?avec=` ne crée pas de variantes à indexer : une seule page par version. -->
  <link rel="canonical" href={gameHref(data.game.slug)} />
</svelte:head>

<div class="space-y-6">
  <header class="flex flex-col gap-4 sm:flex-row">
    {#if data.game.headerUrl}
      <div
        use:tilt
        data-complete={complete || undefined}
        data-tier={complete ? data.tier : undefined}
        data-copies={complete && data.copies > 1 ? data.copies : undefined}
        data-live
        class="game-card relative w-full shrink-0 self-start overflow-hidden rounded-md sm:w-72"
      >
        <img src={data.game.headerUrl} alt="" class="w-full" />
        {#if complete}
          {#if data.tier >= HOLO_TIER}<span class="foil" aria-hidden="true"></span>{/if}
          {#if data.copies > 1}<CardFx copies={data.copies} image={data.game.headerUrl} />{/if}
          <span class="absolute right-2 top-2">
            <CompleteBadge tier={data.tier} copies={data.copies} />
          </span>
        {:else if data.game.totalAchievements > 0}
          <span class="absolute bottom-2 left-2">
            <CompleteBadge tier={data.game.tier ?? 1} goal />
          </span>
        {/if}
      </div>
    {/if}
    <div class="min-w-0 flex-1 space-y-2">
      <h1>{data.game.name}</h1>
      <p class="text-sm text-muted">
        {editionLabel(data.game)} · {m.count_achievements({
          count: data.achievements.length,
        })}
        · {m.count_players({ count: data.players })}
      </p>
      {#if data.versions.length}
        <p class="flex flex-wrap gap-2 text-sm">
          {#each data.versions as version (version.slug)}
            <a
              href={gameHref(version.slug, { avec: withHandle, caches: data.revealed })}
              class="btn h-8"
            >
              {m.version_of({ platform: editionLabel(version) })}
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
      {#if data.user && !data.compare}
        <details class="text-sm">
          <summary class="btn h-8 cursor-pointer list-none">
            <Users size={14} aria-hidden="true" />
            {m.compare_with_friend()}
          </summary>
          <div class="mt-2 max-w-sm rounded border border-line p-2">
            {#if data.friends.length}
              <ul class="space-y-0.5">
                {#each data.friends as friend (friend.id)}
                  <li>
                    <a
                      href={gameHref(data.game.slug, {
                        avec: friend.handle,
                        caches: data.revealed,
                      })}
                      class="block truncate rounded px-2 py-1 hover:bg-raised"
                    >
                      {friend.displayName}
                    </a>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="text-xs text-muted">
                {m.compare_no_friends()}
                <a class="underline hover:text-ink" href="/amis">{m.nav_friends()}</a>
              </p>
            {/if}
          </div>
        </details>
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
              tier={data.tier}
              label={m.progress_toward({ tier: `×${data.next.copies}` })}
            />
            <p class="tabular text-sm text-muted">
              {m.next_tier({
                tier: `×${data.next.copies}`,
                platform: editionLabel(data.next),
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

  {#if data.compare}
    <section class="card space-y-3 p-3" data-testid="compare">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-base">
          {m.comparison()} · {data.compare.user.displayName}
        </h2>
        <a
          class="btn ml-auto h-8"
          href={gameHref(data.game.slug, { caches: data.revealed })}
          data-sveltekit-reset="false"
        >
          {m.compare_quit()}
        </a>
      </div>

      {#if !data.progress}
        <p class="text-sm text-muted">{m.compare_you_dont_own({ game: data.game.name })}</p>
      {:else if !data.compare.progress}
        <p class="text-sm text-muted">
          {m.compare_they_dont_own({
            name: data.compare.user.displayName,
            game: data.game.name,
          })}
        </p>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1">
            <p class="text-xs font-medium text-muted">{m.compare_column_mine()}</p>
            <Progress value={data.progress.completion} tier={complete ? data.tier : 0} />
            <p class="tabular text-xs text-muted">
              {data.progress.unlockedCount} / {data.progress.totalCount}
            </p>
          </div>
          <div class="space-y-1">
            <p class="truncate text-xs font-medium text-muted">
              {data.compare.user.displayName}
            </p>
            <Progress value={data.compare.progress.completion} tier={0} />
            <p class="tabular text-xs text-muted">
              {data.compare.progress.unlockedCount} / {data.compare.progress.totalCount}
            </p>
          </div>
        </div>
        <p class="tabular text-sm" data-testid="compare-summary">
          {m.compare_summary({
            common: data.compare.counts.common,
            mine: data.compare.counts.mine,
            theirs: data.compare.counts.theirs,
            name: data.compare.user.displayName,
          })}
        </p>
      {/if}
    </section>
  {/if}

  {#if data.missables}
    <div
      class="card flex items-start gap-3 p-3 text-sm"
      class:missables-alert={data.missables.count > 0}
      data-testid="missables"
    >
      {#if data.missables.count > 0}
        <TriangleAlert size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      {:else}
        <Check size={18} class="mt-0.5 shrink-0 text-success" aria-hidden="true" />
      {/if}
      <div class="min-w-0 space-y-1">
        <p class="font-medium">
          {data.missables.count > 0
            ? m.missables_title({ count: data.missables.count })
            : m.missables_none()}
        </p>
        <p class="text-muted">
          {#if data.missables.elsewhere}
            {m.missables_elsewhere()}
            <a class="underline hover:text-ink" href="/jeux/{data.missables.elsewhere}">
              {m.missables_elsewhere_link()}
            </a>
          {:else if data.missables.count > 0}
            {missingMissables > 0 || !data.user ? m.missables_text() : m.missables_done()}
            {#if data.missables.partial}{m.missables_partial()}{/if}
          {:else}
            {m.missables_none_text()}
          {/if}
        </p>
      </div>
    </div>
  {/if}

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
        href={gameHref(data.game.slug, { avec: withHandle, caches: !data.revealed })}
        rel="nofollow"
        data-sveltekit-reset="false"
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
    {#each visible.slice(0, shown) as achievement (achievement.id)}
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
                <EyeOff
                  size={12}
                  role="img"
                  class="shrink-0 text-muted"
                  aria-label={m.achievement_hidden()}
                />
              {/if}
              {#if achievement.missable}
                <span class="missable-badge" title={m.missable_hint()}>
                  <TriangleAlert size={11} aria-hidden="true" />
                  {m.missable_badge()}
                </span>
              {/if}
              {#if achievement.guided}
                <BookOpen
                  size={12}
                  role="img"
                  class="shrink-0 text-accent"
                  aria-label={m.guide_badge()}
                />
              {/if}
            </p>
            <p class="truncate text-xs text-muted">{achievement.description}</p>
          </div>
          {#if comparing}
            <span class="flex shrink-0 items-center gap-1" aria-hidden="true">
              <span
                class="compare-mark"
                data-state={achievement.unlockedAt ? 'yes' : 'no'}
                title={m.compare_column_mine()}
              >
                {#if achievement.unlockedAt}
                  <Check size={11} strokeWidth={3} />
                {:else}
                  <Minus size={11} strokeWidth={3} />
                {/if}
              </span>
              <span
                class="compare-mark"
                data-state={theirState(achievement)}
                title={data.compare?.user.displayName}
              >
                {#if theirState(achievement) === 'yes'}
                  <Check size={11} strokeWidth={3} />
                {:else}
                  <Minus size={11} strokeWidth={3} />
                {/if}
              </span>
            </span>
            <span class="sr-only">
              {#if !achievement.masked}
                {theirState(achievement) === 'yes'
                  ? m.compare_check_theirs({ name: data.compare?.user.displayName ?? '' })
                  : m.compare_missing_theirs({ name: data.compare?.user.displayName ?? '' })}
              {/if}
            </span>
          {/if}
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
  {#if visible.length > shown}
    <button type="button" class="btn mx-auto block" onclick={() => (shown += PAGE)}>
      {m.show_more()}
    </button>
  {/if}
</div>
