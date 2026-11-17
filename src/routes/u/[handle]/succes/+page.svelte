<script lang="ts">
  import SiteBadge from '#lib/components/SiteBadge.svelte';
  import StepDots from '#lib/components/StepDots.svelte';
  import { formatDate, formatNumber } from '#lib/labels';
  import { m } from '#lib/paraglide/messages';

  let { data } = $props();
  const { player, board } = $derived(data);

  type Item = (typeof board.categories)[number]['items'][number];

  const CATEGORY_LABELS: Record<string, () => string> = {
    start: m.ach_cat_start,
    cards: m.ach_cat_cards,
    volume: m.ach_cat_volume,
    rarity: m.ach_cat_rarity,
    time: m.ach_cat_time,
    habits: m.ach_cat_habits,
    social: m.ach_cat_social,
    friends: m.ach_cat_friends,
    clan: m.ach_cat_clan,
    season: m.ach_cat_season,
    event: m.ach_cat_event,
    secret: m.ach_cat_secret,
    genres: m.ach_cat_genres,
    themes: m.ach_cat_themes,
  };

  type Filter = 'all' | 'earned' | 'missing';
  const FILTERS: { value: Filter; label: () => string }[] = [
    { value: 'all', label: m.ach_filter_all },
    { value: 'earned', label: m.ach_filter_earned },
    { value: 'missing', label: m.ach_filter_missing },
  ];
  let filter = $state<Filter>('all');
  // Une carte à paliers est à la fois obtenue (ses premiers paliers) et à obtenir (la suite).
  const keep = (item: Item) =>
    filter === 'all' || (filter === 'earned' ? item.unlockedAt !== null : !item.complete);
  interface Suggestion {
    name: string;
    slug: string;
    coverUrl: string | null;
    headerUrl: string | null;
    completion: number | null;
    left: number;
  }
  type Suggestions = { owned: boolean; games: Suggestion[] } | null | 'error';
  // Les idées de jeux ne se chargent qu'à l'ouverture d'une carte, une fois par succès.
  const suggestions = $state<Record<string, Suggestions | 'loading'>>({});
  async function loadSuggestions(code: string | null) {
    // Un échec ne reste pas en mémoire : rouvrir la carte, ou « Réessayer », relance la demande.
    if (!code || (code in suggestions && suggestions[code] !== 'error')) return;
    suggestions[code] = 'loading';
    try {
      const response = await fetch(`/api/succes/suggestions?code=${encodeURIComponent(code)}`);
      suggestions[code] = response.ok ? await response.json() : 'error';
    } catch {
      suggestions[code] = 'error';
    }
  }

  const shown = $derived(
    board.categories
      .map((entry) => ({ ...entry, visible: entry.items.filter(keep) }))
      .filter(({ visible }) => visible.length > 0),
  );
</script>

<svelte:head>
  <title>{m.ach_page_title({ name: player.displayName })}</title>
</svelte:head>

{#snippet line(item: Item, category: string)}
  <div class="flex gap-3">
    <SiteBadge icon={board.icons[item.icon] ?? ''} {category} unlocked={item.unlockedAt !== null} />
    <div class="min-w-0">
      <p class="site-card-title font-medium">{item.title ?? m.ach_secret_title()}</p>
      <p class="text-sm text-muted">{item.text ?? m.ach_secret_text()}</p>
      {#if item.steps.length}
        <StepDots steps={item.steps} />
      {/if}
      {#if item.next}
        <p class="mt-1 text-xs text-muted">
          {m.ach_next_step({ text: item.next })}
        </p>
      {/if}
      {#if item.unlockedAt || item.rarity !== null}
        <p class="mt-1 text-xs text-muted">
          {#if item.unlockedAt}{formatDate(item.unlockedAt)}{/if}
          {#if item.unlockedAt && item.rarity !== null}·{/if}
          {#if item.rarity !== null}
            {m.ach_rarity({
              // Sous 1 %, une décimale : un succès obtenu n'affiche jamais 0 %.
              percent: formatNumber(
                item.rarity > 0 && item.rarity < 1
                  ? Math.max(0.1, Math.round(item.rarity * 10) / 10)
                  : Math.round(item.rarity),
              ),
            })}
          {/if}
        </p>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet ideas(code: string, state: Suggestions | 'loading' | undefined)}
  <div class="mt-2 border-t border-line pt-2 text-sm" data-testid="ach-ideas">
    <p class="label">{m.ach_ideas_label()}</p>
    {#if state === undefined || state === 'loading'}
      <p class="mt-1 text-muted">{m.ach_ideas_loading()}</p>
    {:else if state === 'error' || state === null}
      <p class="mt-1 text-muted">
        {m.action_failed()}
        <button
          type="button"
          class="ml-1 underline hover:text-ink"
          onclick={() => loadSuggestions(code)}
        >
          {m.retry()}
        </button>
      </p>
    {:else if !state.games.length}
      <p class="mt-1 text-muted">{m.ach_ideas_none()}</p>
    {:else}
      {#if !state.owned}
        <p class="mt-1 text-xs text-muted">{m.ach_ideas_catalog()}</p>
      {/if}
      <ul class="mt-1 space-y-1">
        {#each state.games as game (game.slug)}
          <li class="flex items-center gap-2">
            {#if game.coverUrl ?? game.headerUrl}
              <img
                src={game.coverUrl ?? game.headerUrl}
                alt=""
                loading="lazy"
                class="h-6 w-6 shrink-0 rounded object-cover"
              />
            {/if}
            <a class="min-w-0 flex-1 truncate hover:text-ink" href="/jeux/{game.slug}">
              {game.name}
            </a>
            <span class="tabular shrink-0 text-xs text-muted">
              {#if game.completion !== null}
                {formatNumber(Math.floor(game.completion))} % ·
              {/if}
              {m.ach_ideas_left({ count: game.left })}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

<div class="space-y-8">
  <header class="space-y-2">
    <a class="text-sm text-muted hover:text-ink" href="/u/{player.handle}">{player.displayName}</a>
    <h1>{m.ach_heading()}</h1>
    <p class="text-muted">{m.ach_progress({ earned: board.earned, total: board.total })}</p>
    <div
      class="flex rounded border border-line text-sm w-fit"
      role="group"
      aria-label={m.ach_filter_label()}
    >
      {#each FILTERS as option (option.value)}
        <button
          type="button"
          class="px-3 py-1.5"
          aria-pressed={filter === option.value}
          class:bg-raised={filter === option.value}
          class:text-muted={filter !== option.value}
          onclick={() => (filter = option.value)}
        >
          {option.label()}
        </button>
      {/each}
    </div>
    <nav class="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={m.ach_jump_label()}>
      {#each shown as { category } (category)}
        <a class="text-muted hover:text-ink" href="#ach-{category}"
          >{CATEGORY_LABELS[category]?.()}</a
        >
      {/each}
    </nav>
  </header>

  {#each shown as { category, earned, size, visible } (category)}
    <section class="scroll-mt-20" id="ach-{category}" aria-labelledby="ach-title-{category}">
      <details open class="group space-y-3">
        <summary class="flex cursor-pointer list-none items-center gap-2">
          <h2 id="ach-title-{category}">
            {CATEGORY_LABELS[category]?.()}
            <span class="tabular text-sm text-muted">
              {earned}/{size}
            </span>
          </h2>
          <span class="text-muted transition-transform group-open:rotate-90" aria-hidden="true"
            >›</span
          >
        </summary>
        {#if category === 'genres'}
          <p class="text-sm text-muted">{m.ach_genres_note()}</p>
        {/if}
        <ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {#each visible as item (item.key)}
            <li
              class="card site-card p-3"
              class:opacity-70={!item.unlockedAt}
              data-tier={item.tier || undefined}
            >
              {#if item.proof || item.suggest}
                <details
                  ontoggle={(event) => {
                    if (item.suggest && event.currentTarget.open) loadSuggestions(item.code);
                  }}
                >
                  <summary class="cursor-pointer list-none">{@render line(item, category)}</summary>
                  {#if item.suggest && item.code}
                    {@render ideas(item.code, suggestions[item.code])}
                  {/if}
                  {#if item.proof}
                    <div class="mt-2 border-t border-line pt-2 text-sm">
                      <p class="label">{m.ach_proof_label()}</p>
                      <ul class="mt-1 space-y-1">
                        {#each item.proof.games as game (game.slug)}
                          <li class="flex items-center gap-2">
                            {#if game.coverUrl ?? game.headerUrl}
                              <img
                                src={game.coverUrl ?? game.headerUrl}
                                alt=""
                                loading="lazy"
                                class="h-6 w-6 shrink-0 rounded object-cover"
                              />
                            {/if}
                            <a class="hover:text-ink" href="/jeux/{game.slug}">{game.name}</a>
                          </li>
                        {/each}
                        {#each item.proof.achievements as achievement (achievement.id)}
                          <li class="flex items-center gap-2">
                            {#if achievement.iconUrl}
                              <img
                                src={achievement.iconUrl}
                                alt=""
                                loading="lazy"
                                class="h-6 w-6 shrink-0 rounded object-cover"
                              />
                            {/if}
                            <a class="hover:text-ink" href="/succes/{achievement.id}">
                              {achievement.name}
                            </a>
                            <span class="text-muted">· {achievement.game.name}</span>
                          </li>
                        {/each}
                        {#each item.proof.users as user (user.id)}
                          <li class="flex items-center gap-2">
                            {#if user.avatarUrl}
                              <img
                                src={user.avatarUrl}
                                alt=""
                                loading="lazy"
                                class="h-6 w-6 shrink-0 rounded-full object-cover"
                              />
                            {/if}
                            <a class="hover:text-ink" href="/u/{user.handle}">{user.displayName}</a>
                          </li>
                        {/each}
                        {#each item.proof.clans as clan (clan.id)}
                          <li class="flex items-center gap-2">
                            <a class="hover:text-ink" href="/clans/{clan.slug}">{clan.name}</a>
                          </li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                </details>
              {:else}
                {@render line(item, category)}
              {/if}
            </li>
          {/each}
        </ul>
      </details>
    </section>
  {:else}
    <p class="text-muted">{m.ach_filter_empty()}</p>
  {/each}

  <p class="text-xs text-muted">
    {m.ach_icons_credit()}
    <a class="underline hover:text-ink" href="https://game-icons.net" rel="noopener"
      >game-icons.net</a
    >
    ·
    <a
      class="underline hover:text-ink"
      href="https://creativecommons.org/licenses/by/3.0/"
      rel="license noopener">CC BY 3.0</a
    >
  </p>
</div>
