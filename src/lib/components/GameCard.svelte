<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import type { Platform } from '#prisma';
  import Flame from '@lucide/svelte/icons/flame';
  import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
  import CardFx from './CardFx.svelte';
  import CompleteBadge from './CompleteBadge.svelte';
  import Progress from './Progress.svelte';
  import { tilt } from '#lib/actions/tilt';
  import { editionLabel, formatPercent } from '#lib/labels';
  import { HOLO_TIER, isComplete, stepOf, type CardProgress, type NextCopy } from '#lib/collection';

  interface Props {
    game: {
      name: string;
      slug: string;
      platform: Platform;
      console?: string | null;
      headerUrl: string | null;
      totalAchievements: number;
    };
    progress?: CardProgress | null;
    layout?: 'grille' | 'liste';
    versions?: { platform: Platform; console?: string | null; slug: string; completion: number }[];
    tier?: number;
    /** Le niveau à gagner, quand la carte n'est pas finie ; sinon `tier`. */
    target?: number;
    copies?: number;
    next?: NextCopy | null;
    seasonEligible?: boolean;
    /** Vitrine et révélation : l'animation tourne sans attendre le survol. */
    live?: boolean;
  }

  let {
    game,
    progress = null,
    layout = 'grille',
    versions = [],
    tier = 0,
    target = 0,
    copies = 1,
    next = null,
    seasonEligible = false,
    live = false,
  }: Props = $props();
  const list = $derived(layout === 'liste');
  const complete = $derived(isComplete(progress));
  const level = $derived(tier || 1);
  const step = $derived(progress ? stepOf(progress.completion) : 0);
  const goal = $derived(progress && !complete ? target || tier : 0);
  let imageFailed = $state(false);

  /** L'image peut avoir déjà échoué avant que Svelte ne prenne la main sur la page. */
  function watchImage(frame: HTMLElement) {
    const image = frame.querySelector('img');
    if (image?.complete && image.naturalWidth === 0) imageFailed = true;
    // Sur le cadre : une action sur l'image ajouterait un gestionnaire en ligne, refusé par la CSP.
    const onError = () => (imageFailed = true);
    frame.addEventListener('error', onError, true);
    return { destroy: () => frame.removeEventListener('error', onError, true) };
  }

  /** Tirée du jeu pour rester stable : les cartes d'une page ne brillent pas en même temps. */
  const phase = $derived(
    (([...game.slug].reduce((sum, letter) => sum * 31 + letter.charCodeAt(0), 7) >>> 0) % 1000) /
      1000,
  );
</script>

<a
  href="/jeux/{game.slug}"
  use:tilt
  data-complete={complete || undefined}
  data-tier={complete ? level : undefined}
  data-step={step || undefined}
  data-owned={progress ? true : undefined}
  data-next={next?.copies}
  data-copies={complete && copies > 1 ? copies : undefined}
  data-live={live || undefined}
  style:--phase={phase}
  class="game-card card group flex overflow-hidden"
  class:flex-col={!list}
  class:items-center={list}
>
  <div
    use:watchImage
    class="relative shrink-0 overflow-hidden bg-raised {list
      ? 'h-14 w-28'
      : 'aspect-[460/215] w-full'}"
  >
    {#if game.headerUrl && !imageFailed}
      <img
        src={game.headerUrl}
        alt=""
        loading="lazy"
        class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
    {:else}
      <span class="grid h-full w-full place-items-center text-muted" aria-hidden="true">
        <Gamepad2 size={24} />
      </span>
    {/if}
    {#if seasonEligible && !list}
      <span class="season-badge absolute left-2 top-2" title={m.season_badge_help()}>
        <Flame size={11} aria-hidden="true" />
        {m.nav_season()}
      </span>
    {/if}
    {#if step && !list}
      <span class="step-badge absolute right-2 top-2">{formatPercent(step * 25)}</span>
    {/if}
    {#if goal && !list}
      <span class="absolute bottom-2 left-2"><CompleteBadge tier={goal} goal /></span>
    {/if}
    {#if complete}
      {#if level >= HOLO_TIER}<span class="foil" aria-hidden="true"></span>{/if}
      {#if copies > 1 && !list}<CardFx {copies} image={game.headerUrl} />{/if}
      {#if !list}
        <span class="absolute right-2 top-2"><CompleteBadge tier={level} {copies} /></span>
      {/if}
    {/if}
  </div>
  <div class="min-w-0 flex-1 space-y-2 p-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="truncate text-sm font-medium">{game.name}</h3>
      {#if seasonEligible && list}
        <span class="season-badge shrink-0" title={m.season_badge_help()}>
          <Flame size={11} aria-hidden="true" />
          {m.nav_season()}
        </span>
      {/if}
      {#if complete && list}<CompleteBadge tier={level} {copies} />{/if}
      {#if goal && list}<CompleteBadge tier={goal} goal />{/if}
    </div>
    {#if progress}
      {#if next}
        <Progress
          value={next.completion}
          tier={level}
          label={m.progress_toward_on({ tier: `×${next.copies}`, game: game.name })}
        />
        <p class="tabular truncate text-xs text-muted">
          {m.next_tier({
            tier: `×${next.copies}`,
            platform: editionLabel(next),
            percent: Math.round(next.completion),
          })}
        </p>
      {:else}
        <Progress
          value={progress.completion}
          tier={complete ? level : 0}
          {step}
          label={m.progress_on({ game: game.name })}
        />
        <p class="tabular truncate text-xs text-muted">
          {#if versions.length > 1}
            {versions.map((v) => `${editionLabel(v)} ${formatPercent(v.completion)}`).join(' · ')}
          {:else}
            {progress.unlockedCount} / {game.totalAchievements} · {formatPercent(
              progress.completion,
            )}
          {/if}
        </p>
      {/if}
    {:else}
      <p class="text-xs text-muted">
        {editionLabel(game)} · {m.count_achievements({ count: game.totalAchievements })}
      </p>
    {/if}
  </div>
</a>
