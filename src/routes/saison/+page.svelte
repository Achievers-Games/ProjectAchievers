<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import GameCard from '$lib/components/GameCard.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { formatDate, formatNumber, formatPercent } from '$lib/labels';
  import { RARITY_POINTS, type SeasonState } from '$lib/season';

  const MINUTE = 60_000;

  const EMBERS = 36;

  let { data } = $props();

  /** Réparties par calcul : le serveur et le navigateur dessinent les mêmes braises. */
  const embers = Array.from({ length: EMBERS }, (_, index) => ({
    left: (index * 37) % 100,
    size: 2 + (index % 4),
    delay: -((index * 730) % 7000),
    duration: 3500 + ((index * 410) % 3500),
    drift: ((index * 53) % 90) - 45,
  }));

  let now = $state<number | null>(null);

  onMount(() => {
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), MINUTE);
    return () => clearInterval(timer);
  });

  const stateLabels: Record<SeasonState, () => string> = {
    soon: m.season_state_soon,
    running: m.season_state_running,
    ended: m.season_state_ended,
  };

  const left = $derived(now === null ? null : Math.max(0, data.endsAt.getTime() - now));
  const countdown = $derived(
    left === null
      ? ''
      : m.season_countdown({
          days: Math.floor(left / (24 * 60 * MINUTE)),
          hours: Math.floor(left / (60 * MINUTE)) % 24,
          minutes: Math.floor(left / MINUTE) % 60,
        }),
  );

  const goalPercent = $derived(Math.min(100, (data.unlocked / data.goal) * 100));
  const reached = $derived(data.tiers.filter((tier) => data.points >= tier).length);
  const nextTier = $derived(data.tiers[reached]);

  const steps = $derived([
    { name: m.season_tier_1(), reward: m.season_reward_1(), points: data.tiers[0] },
    { name: m.season_tier_2(), reward: m.season_reward_2(), points: data.tiers[1] },
    { name: m.season_tier_3(), reward: m.season_reward_3(), points: data.tiers[2] },
  ]);

  const scale = $derived([
    { label: m.season_rule_common(), points: RARITY_POINTS.common },
    { label: m.season_rule_uncommon(), points: RARITY_POINTS.uncommon },
    { label: m.season_rule_rare(), points: RARITY_POINTS.rare },
    { label: m.season_rule_epic(), points: RARITY_POINTS.epic },
    { label: m.season_rule_complete(), points: data.completionBonus },
  ]);
</script>

<svelte:head>
  <title>{m.banner_season_title()} — Project Achievers</title>
  <meta name="description" content={m.season_intro()} />
</svelte:head>

<div class="space-y-8">
  <header class="space-y-4">
    <div class="season-art">
      <img src="/saison/finish-them.webp" alt="Finish them" width="1536" height="640" />
      <div class="season-embers" aria-hidden="true">
        {#each embers as ember, index (index)}
          <span
            style:left="{ember.left}%"
            style:width="{ember.size}px"
            style:height="{ember.size}px"
            style:animation-delay="{ember.delay}ms"
            style:animation-duration="{ember.duration}ms"
            style:--drift="{ember.drift}px"
          ></span>
        {/each}
      </div>
    </div>
    <div class="space-y-2">
      <p class="label uppercase tracking-wide">{stateLabels[data.state]()}</p>
      <h1>{m.banner_season_title()}</h1>
      <p class="max-w-xl text-muted">{m.season_intro()}</p>
      <!-- Avant l'ouverture, la page annonce seulement « bientôt », sans date ni compte à rebours. -->
      {#if data.state !== 'soon'}
        <p class="tabular text-sm font-semibold">
          {formatDate(data.startsAt)} → {formatDate(data.endsAt)}
          {#if countdown && data.state !== 'ended'}· {countdown}{/if}
        </p>
      {/if}
    </div>
  </header>

  <section class="card space-y-3 p-5" aria-labelledby="objectif">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="objectif">{m.season_goal_title()}</h2>
      <p class="tabular text-sm font-semibold">
        {formatNumber(data.unlocked)} / {formatNumber(data.goal)}
        · {formatPercent(goalPercent)}
      </p>
    </div>
    <Progress value={goalPercent} label={m.season_goal_title()} tier={1} />
    <p class="text-sm text-muted">{m.season_goal_text({ goal: formatNumber(data.goal) })}</p>
  </section>

  <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
    <section class="min-w-0 space-y-3" aria-labelledby="paliers">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="paliers">{m.season_tiers_title()}</h2>
        {#if data.user}
          <p class="tabular text-sm font-semibold">
            {m.count_points({ count: data.points })}
          </p>
        {/if}
      </div>
      <ol class="card divide-y divide-line">
        {#each steps as step, index (step.points)}
          <li
            class="flex items-center gap-3 p-4"
            class:opacity-60={index >= reached && !!data.user}
          >
            <span class="tabular w-16 shrink-0 text-sm font-bold text-gold">
              {formatNumber(step.points)}
            </span>
            <span class="min-w-0">
              <span class="block font-medium">{step.name}</span>
              <span class="block text-sm text-muted">{step.reward}</span>
            </span>
          </li>
        {/each}
      </ol>
      {#if data.user && nextTier}
        <Progress value={(data.points / nextTier) * 100} label={m.season_tiers_title()} />
      {/if}

      <h2 class="pt-4">{m.season_rules_title()}</h2>
      <ul class="card divide-y divide-line">
        {#each scale as rule (rule.label)}
          <li class="flex items-center justify-between gap-3 p-3 text-sm">
            <span>{rule.label}</span>
            <span class="tabular shrink-0 font-semibold">{formatNumber(rule.points)}</span>
          </li>
        {/each}
      </ul>
      <p class="text-sm text-muted">{m.season_rules_text()}</p>
      {#if data.ignored}
        <p class="text-sm text-muted">{m.season_ignored({ count: formatNumber(data.ignored) })}</p>
      {/if}
    </section>

    <section class="min-w-0 space-y-3" aria-labelledby="classement-saison">
      <h2 id="classement-saison">{m.ranking()}</h2>
      {#if data.ranking.length}
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
                <span class="tabular text-sm">{formatNumber(row.points)}</span>
              </a>
            </li>
          {/each}
        </ol>
      {:else}
        <Empty title={m.season_ranking_empty()} />
      {/if}
    </section>
  </div>

  {#if data.waiting.length}
    <section class="space-y-3" aria-labelledby="attente">
      <div class="flex items-baseline justify-between gap-4">
        <h2 id="attente">{m.season_waiting_title()}</h2>
        <a href="/jeux?filtre=saison&tri=progression" class="text-sm text-muted hover:text-ink">
          {m.season_all_games()}
        </a>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {#each data.waiting as game (game.id)}
          <GameCard
            {game}
            progress={game.progress}
            versions={game.versions}
            tier={game.tier}
            copies={game.copies}
            next={game.next}
            seasonEligible={game.seasonEligible}
          />
        {/each}
      </div>
    </section>
  {:else if !data.user}
    <a href="/connexion?retour=/saison" class="btn btn-primary">{m.hero_start()}</a>
  {/if}
</div>
