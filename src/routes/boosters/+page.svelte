<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { getLocale } from '#lib/paraglide/runtime';
  import { enhance } from '$app/forms';
  import BoosterReveal from '#lib/components/BoosterReveal.svelte';
  import CardBannerChoice from '#lib/components/CardBannerChoice.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import { submitWithToast } from '#lib/forms';
  import { BOOSTER_PRICE, DAILY_MAX, MYTHIQUE_PITY, RATES } from '#lib/boosters';
  import type { EditionKind } from '#prisma';

  let { data, form } = $props();

  const submit = submitWithToast({ reset: false });

  const editionName: Record<EditionKind, () => string> = {
    RELIEF: () => m.edition_relief(),
    VIVANTE: () => m.edition_vivante(),
    MYTHIQUE: () => m.edition_mythique(),
  };
  const percent = (value: number) =>
    new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 2 }).format(
      value,
    );
  const rates = $derived([
    { kind: 'RELIEF' as const, chance: 1 - RATES.NORMAL.VIVANTE - RATES.NORMAL.MYTHIQUE },
    { kind: 'VIVANTE' as const, chance: RATES.NORMAL.VIVANTE },
    { kind: 'MYTHIQUE' as const, chance: RATES.NORMAL.MYTHIQUE },
  ]);
  const opened = $derived(form && 'opened' in form ? form.opened : null);
  const info = $derived(data.state);
  /** La dernière ouverture déjà révélée : la scène ne rejoue pas après sa fermeture. */
  let seen = $state<string | null>(null);
  let openForm = $state<HTMLFormElement>();
  let dailyButton = $state<HTMLButtonElement>();
  let shardsButton = $state<HTMLButtonElement>();
  /**
   * Le booster suivant, proposé à la fin d'une ouverture : un booster offert d'abord, sinon un
   * booster payé en éclats, dont le prix est alors affiché sur le bouton.
   */
  const next = $derived.by(() => {
    if (!info.canDraw) return null;
    if (info.daily > 0)
      return { label: m.booster_open_next(), open: () => openForm?.requestSubmit(dailyButton) };
    if (info.shards >= BOOSTER_PRICE)
      return {
        label: m.booster_open_next_shards({ price: BOOSTER_PRICE }),
        open: () => openForm?.requestSubmit(shardsButton),
      };
    return null;
  });
</script>

{#if opened && seen !== opened.id}
  {#key opened.id}
    <BoosterReveal
      cards={opened.cards}
      kind={opened.kind}
      {next}
      collectionHref="/boosters/collection"
      onclose={() => (seen = opened.id)}
    >
      {#snippet inspectionActions(card)}
        {#if card.editionId && data.user}
          {#key card.editionId}
            <CardBannerChoice
              card={{
                ...card,
                editionId: card.editionId,
                bannerCompletion: card.bannerCompletion ?? null,
              }}
              person={data.user}
              equipped={data.bannerEditionId === card.editionId}
            />
          {/key}
        {/if}
      {/snippet}
    </BoosterReveal>
  {/key}
{/if}

<svelte:head><title>{m.boosters_title()} — Project Achievers</title></svelte:head>

{#snippet card(
  item: {
    kind: EditionKind;
    duplicate: boolean;
    shards: number;
    game: { name: string; headerUrl: string | null } | null;
  },
  index: number,
)}
  <li class="booster-card" data-edition={item.kind.toLowerCase()} style="--delay: {index * 0.45}s">
    <div class="art">
      {#if item.game?.headerUrl}
        <img src={item.game.headerUrl} alt="" loading="lazy" />
      {/if}
      <span class="badge">{editionName[item.kind]()}</span>
    </div>
    <div class="px-3 py-2">
      <p class="truncate text-sm font-medium">{item.game?.name ?? '—'}</p>
      <p class="text-xs text-muted">
        {item.duplicate ? m.boosters_duplicate({ count: item.shards }) : m.boosters_new()}
      </p>
    </div>
  </li>
{/snippet}

<div class="mx-auto max-w-3xl space-y-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h1>{m.boosters_title()}</h1>
      <p class="text-sm text-muted">{m.boosters_help()}</p>
    </div>
    <a href="/boosters/collection" class="btn">{m.collection_link()}</a>
  </div>

  <section class="card grid gap-4 p-4 sm:grid-cols-2">
    <div class="space-y-1">
      <p class="text-2xl font-semibold">{m.boosters_shards({ count: info.shards })}</p>
      <p class="text-sm text-muted">{m.boosters_daily({ count: info.daily, max: DAILY_MAX })}</p>
      {#if info.nextGolden}<p class="text-sm">{m.boosters_next_golden()}</p>{/if}
      {#if info.eligible.MYTHIQUE > 0}
        <p class="text-sm text-muted">
          {m.boosters_pity({ count: MYTHIQUE_PITY - info.pityMythique })}
        </p>
      {/if}
    </div>
    <form
      bind:this={openForm}
      method="POST"
      action="?/open"
      use:enhance={submit}
      class="flex flex-col gap-2"
    >
      <button
        bind:this={dailyButton}
        name="source"
        value="daily"
        class="btn btn-primary"
        disabled={!info.canDraw || info.daily < 1}
      >
        {m.boosters_open_daily()}
      </button>
      <button
        bind:this={shardsButton}
        name="source"
        value="shards"
        class="btn"
        disabled={!info.canDraw || info.shards < BOOSTER_PRICE}
      >
        {m.boosters_buy({ price: BOOSTER_PRICE })}
      </button>
    </form>
  </section>

  {#if !info.canDraw}
    <Empty title={m.boosters_no_cards()} />
  {:else}
    <p class="text-sm text-muted">
      {m.boosters_eligible({
        relief: info.eligible.RELIEF,
        vivante: info.eligible.VIVANTE,
        mythique: info.eligible.MYTHIQUE,
      })}
    </p>
  {/if}

  {#if opened}
    <section class="space-y-3" aria-live="polite">
      <h2>{opened.kind === 'GOLDEN' ? m.boosters_golden() : m.boosters_opened()}</h2>
      {#key opened.id}
        <ul class="grid gap-3 sm:grid-cols-3">
          {#each opened.cards as item, index (index)}
            {@render card(item, index)}
          {/each}
        </ul>
      {/key}
    </section>
  {/if}

  <section class="space-y-3">
    <h2>{m.boosters_rates()}</h2>
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-muted">
          <th class="py-1 font-normal">{m.boosters_rate_edition()}</th>
          <th class="py-1 text-right font-normal">{m.boosters_rate_chance()}</th>
        </tr>
      </thead>
      <tbody>
        {#each rates as rate (rate.kind)}
          <tr class="border-t border-line">
            <td class="py-1">{editionName[rate.kind]()}</td>
            <td class="py-1 text-right tabular-nums">{percent(rate.chance)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="text-xs text-muted">{m.boosters_rates_help({ pity: MYTHIQUE_PITY })}</p>
  </section>

  {#if data.history.length}
    <section class="space-y-3">
      <h2>{m.boosters_history()}</h2>
      <ul class="space-y-2">
        {#each data.history as opening (opening.id)}
          <li class="card flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span class="text-muted">
              {new Intl.DateTimeFormat(getLocale(), {
                dateStyle: 'short',
                timeStyle: 'short',
              }).format(new Date(opening.createdAt))}
            </span>
            {#each opening.cards as item, index (index)}
              <span data-edition={item.kind.toLowerCase()} class="history-chip">
                {item.game?.name ?? '—'} · {editionName[item.kind]()}
              </span>
            {/each}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  [data-edition='relief'] {
    --edition: #60a5fa;
  }
  [data-edition='vivante'] {
    --edition: #a78bfa;
  }
  [data-edition='mythique'] {
    --edition: #fbbf24;
  }
  .booster-card {
    overflow: hidden;
    border-radius: 0.75rem;
    border: 1px solid var(--edition);
    background: var(--color-surface, rgb(255 255 255 / 0.04));
    box-shadow: 0 0 24px color-mix(in srgb, var(--edition) 35%, transparent);
    animation: reveal 0.6s ease-out var(--delay) both;
  }
  .art {
    position: relative;
    aspect-ratio: 460 / 215;
    background: color-mix(in srgb, var(--edition) 20%, black);
  }
  .art img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .badge {
    position: absolute;
    left: 0.5rem;
    top: 0.5rem;
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: black;
    background: var(--edition);
  }
  .history-chip {
    border-radius: 999px;
    border: 1px solid var(--edition);
    padding: 0 0.5rem;
  }
  @keyframes reveal {
    from {
      opacity: 0;
      transform: rotateY(90deg) scale(0.9);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .booster-card {
      animation: none;
    }
  }
</style>
