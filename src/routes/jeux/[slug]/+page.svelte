<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import PageBackdrop from '#lib/components/PageBackdrop.svelte';
  import { gameArt } from '#lib/art';
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
  import LureCard from '#lib/components/LureCard.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import GameGuides from './GameGuides.svelte';
  import { editionLabel, formatDate, formatPercent, formatRarity } from '#lib/labels';
  import { getLocale } from '#lib/paraglide/runtime';
  import { isComplete } from '#lib/collection';
  import { compareBucket } from '#lib/compare';

  let { data } = $props();

  type Filter = 'tous' | 'obtenus' | 'restants' | 'manquables' | 'commun' | 'moi' | 'lui';
  const complete = $derived(isComplete(data.progress));
  /** Un jeu sans succès (Honkai Impact 3rd sur Steam) : seul le temps de jeu y est suivi. */
  const noAchievements = $derived(data.achievementTotal === 0);
  const toggleHidden = submitWithToast({ reset: false });

  /** La comparaison ne se déroule que si les deux possèdent cette version précise. */
  const comparing = $derived(Boolean(data.compare?.progress && data.progress));
  const theirUnlocks = $derived(new Set(data.compare?.visible ?? []));
  const withHandle = $derived(data.compare?.user.handle ?? null);

  const filter = $derived(data.filter);
  const sort = $derived(data.sort);

  function achievementHref(changes: Record<string, string | null>) {
    const url = new URL(page.url.href);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    return url.pathname + url.search;
  }

  function changeAchievements(changes: Record<string, string | null>) {
    void goto(achievementHref({ affiches: null, ...changes }), { reset: false });
  }

  /** Les paramètres de la page voyagent ensemble : révéler les succès cachés garde `avec`. */
  function gameHref(
    slug: string,
    options: { avec?: string | null; joueur?: string | null; caches?: boolean } = {},
  ) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- copie locale, jamais observée
    const search = new URLSearchParams();
    if (options.joueur) search.set('joueur', options.joueur);
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

  const secrets = $derived(data.secrets);

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
          ...(data.hasMissables
            ? [{ value: 'manquables' as const, label: m.filter_missable() }]
            : []),
        ],
  );

  const missingMissables = $derived(data.missingMissables);

  /** Des minutes en heures, à la demi-heure près, écrites dans la langue du visiteur. */
  const hours = (minutes: number) =>
    new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(
      Math.max(0.5, Math.round(minutes / 30) / 2),
    );

  // Pour les moteurs : ce que cherchent les chasseurs de succès (« Hotline Miami succès 100 % »).
  // La plateforme s'ajoute quand le jeu a d'autres versions : deux fiches, deux titres distincts.
  const seoAchievements = $derived(m.count_achievements({ count: data.achievementTotal }));
  const seoTitle = $derived(
    data.achievementTotal === 0
      ? data.game.name
      : data.versions.length
        ? m.game_seo_title_platform({
            game: data.game.name,
            platform: editionLabel(data.game),
            achievements: seoAchievements,
          })
        : m.game_seo_title({ game: data.game.name, achievements: seoAchievements }),
  );
  // Les vraies informations de la fiche, pas une formule creuse : manquables, temps, guides.
  const seoDescription = $derived(
    [
      m.game_seo_description({ game: data.game.name, achievements: seoAchievements }),
      data.missables && !data.missables.partial
        ? data.missables.count
          ? m.game_seo_missables({ count: data.missables.count })
          : m.game_seo_no_missables()
        : null,
      data.completionTime
        ? m.game_seo_time({ hours: hours(data.completionTime.median) })
        : data.lure?.completionistMinutes
          ? m.game_seo_time({ hours: hours(data.lure.completionistMinutes) })
          : null,
      data.guides.length ? m.game_seo_guides({ count: data.guides.length }) : null,
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<!-- `?avec=` ne crée pas de variantes à indexer : une seule page par version. -->
<Seo
  title="{seoTitle} — Achievers"
  description={seoDescription}
  shareTitle={data.game.name}
  path={gameHref(data.game.slug)}
  image={data.game.headerUrl}
  jsonLd={{
    '@type': 'VideoGame',
    name: data.game.name,
    ...(data.game.headerUrl ? { image: data.game.headerUrl } : {}),
  }}
/>

{#if data.game.headerUrl}
  <!-- La grande image du jeu en ambiance, atténuée : la page se lit comme d'habitude. -->
  <PageBackdrop
    images={data.game.artUrl
      ? [data.game.artUrl, ...gameArt(data.game.headerUrl)]
      : gameArt(data.game.headerUrl)}
    fit={data.game.artUrl ? 'cover' : 'band'}
    soft
  />
{/if}

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
          count: data.achievementTotal,
        })}
        · {m.count_players({ count: data.players })}
      </p>
      {#if data.completionTime}
        <p class="text-sm text-muted" data-testid="game-time">
          {m.game_completion_time({
            hours: hours(data.completionTime.median),
            count: data.completionTime.sample,
          })}
        </p>
      {/if}
      {#if data.lure}
        <LureCard
          url={data.lure.url}
          hours={data.lure.completionistMinutes ? hours(data.lure.completionistMinutes) : null}
        />
      {/if}
      {#if data.versions.length}
        <p class="flex flex-wrap gap-2 text-sm">
          {#each data.versions as version (version.slug)}
            <a
              href={gameHref(version.slug, {
                avec: withHandle,
                joueur: data.player?.user.handle,
                caches: data.revealed,
              })}
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
      {#if data.user && !data.compare && !noAchievements}
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
          {#if noAchievements}
            {#if data.progress.playtimeMinutes > 0}
              <p class="tabular text-sm text-muted">
                {m.playtime_hours({ hours: hours(data.progress.playtimeMinutes) })}
              </p>
            {/if}
          {:else}
            <Progress value={data.progress.completion} tier={complete ? data.tier : 0} />
            <p class="tabular text-sm text-muted">
              {data.progress.unlockedCount} / {data.progress.totalCount} · {formatPercent(
                data.progress.completion,
              )}
              {#if data.progress.playtimeMinutes > 0}
                · {m.playtime_hours({ hours: hours(data.progress.playtimeMinutes) })}
              {/if}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  </header>

  {#if data.player}
    <section class="card space-y-3 p-3" data-testid="game-player">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-base">
          <a href="/u/{data.player.user.handle}" class="hover:underline">
            {m.game_player_progress({ name: data.player.user.displayName })}
          </a>
        </h2>
        <div class="ml-auto flex flex-wrap gap-2">
          {#if data.player.canCompare}
            <a
              class="btn h-8"
              href={gameHref(data.game.slug, {
                avec: data.player.user.handle,
                caches: data.revealed,
              })}
            >
              {m.game_player_compare()}
            </a>
          {/if}
          {#if !data.player.self}
            <a
              class="btn h-8"
              href={gameHref(data.game.slug, { caches: data.revealed })}
              data-sveltekit-reset="false"
            >
              {m.game_player_close()}
            </a>
          {/if}
        </div>
      </div>
      <div class="max-w-sm space-y-1">
        {#if !noAchievements}
          <Progress value={data.player.progress.completion} tier={0} />
        {/if}
        <p class="tabular text-sm text-muted">
          {#if !noAchievements}
            {data.player.progress.unlockedCount} / {data.player.progress.totalCount} · {formatPercent(
              data.player.progress.completion,
            )}
          {/if}
          {#if data.player.playtimePrivate}
            {#if !noAchievements}·{/if}
            <span data-testid="game-player-time">{m.playtime_private()}</span>
          {:else if data.player.progress.playtimeMinutes > 0}
            {#if !noAchievements}·{/if}
            <span data-testid="game-player-time"
              >{m.playtime_hours({ hours: hours(data.player.progress.playtimeMinutes) })}</span
            >
          {/if}
        </p>
      </div>
    </section>
  {/if}

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

  {#if data.missables && !noAchievements}
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

  {#if !noAchievements || data.guides.length}
    <GameGuides slug={data.game.slug} guides={data.guides} />
  {/if}

  {#if noAchievements}
    <div class="card space-y-1 p-3 text-sm" data-testid="no-achievements">
      <p class="font-medium">{m.game_no_achievements()}</p>
      <p class="text-muted">{m.game_no_achievements_text()}</p>
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <div
        class="flex rounded border border-line"
        role="group"
        aria-label={m.filter_achievements()}
      >
        {#each filters as item (item.value)}
          <button
            type="button"
            onclick={() =>
              changeAchievements({ succes: item.value === 'tous' ? null : item.value })}
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
      <select
        class="input ml-auto w-auto"
        aria-label={m.sort_achievements_label()}
        value={sort}
        onchange={(event) =>
          changeAchievements({ tri: event.currentTarget.value === 'nom' ? 'nom' : null })}
      >
        <option value="rarete">{m.sort_rarest()}</option>
        <option value="nom">{m.sort_name()}</option>
      </select>
    </div>

    <ul class="card divide-y divide-line">
      {#each data.achievements as achievement (achievement.id)}
        <li>
          <a
            href="/succes/{achievement.id}{data.revealed && achievement.secret ? '?caches=1' : ''}"
            data-unlocked={achievement.unlockedAt ? '' : undefined}
            class="achievement-row flex items-center gap-3 p-3 transition-colors hover:bg-raised"
          >
            <span class="relative shrink-0">
              {#if achievement.iconUrl}
                <AchievementIcon
                  src={achievement.iconUrl}
                  size={40}
                  dim={!achievement.unlockedAt}
                />
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
                  <span class="font-semibold text-success"
                    >{formatDate(achievement.unlockedAt)}</span
                  >
                {:else if achievement.globalRarity !== null}
                  {m.percent({ value: formatRarity(achievement.globalRarity) })}
                {/if}
              </p>
            </div>
          </a>
        </li>
      {/each}
    </ul>
    {#if data.nextAchievements}
      <a
        class="btn mx-auto block"
        data-sveltekit-reset="false"
        href={achievementHref({ affiches: String(data.nextAchievements) })}
      >
        {m.show_more()}
      </a>
    {/if}
  {/if}
</div>
