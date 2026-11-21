<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { getLocale } from '#lib/paraglide/runtime';
  import { enhance } from '$app/forms';
  import BoosterReveal from '#lib/components/BoosterReveal.svelte';
  import { submitWithToast } from '#lib/forms';
  import { CARDS_PER_BOOSTER, EDITIONS, MYTHIQUE_PITY } from '#lib/boosters';
  import type { BoosterKind, EditionKind } from '#prisma';

  let { data, form } = $props();

  const submit = submitWithToast({ reset: false });

  const editionName: Record<EditionKind, () => string> = {
    RELIEF: () => m.edition_relief(),
    VIVANTE: () => m.edition_vivante(),
    MYTHIQUE: () => m.edition_mythique(),
  };
  const percent = (value: number) =>
    new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 3 }).format(
      value,
    );

  const opened = $derived(form && 'opened' in form ? form.opened : null);
  const simulation = $derived(form && 'simulation' in form ? form.simulation : null);
  /** La garantie de Mythique d'une session d'essai : elle avance comme sur un vrai compte. */
  let pity = $state(0);
  let forceMythique = $state(false);
  let seen = $state<string | null>(null);
  let lastKind = $state<BoosterKind>('NORMAL');
  let openForm = $state<HTMLFormElement>();
  let normalButton = $state<HTMLButtonElement>();
  let goldenButton = $state<HTMLButtonElement>();
  let counted: string | null = null;
  $effect(() => {
    if (opened && counted !== opened.id) {
      counted = opened.id;
      pity = opened.pityMythique;
      forceMythique = false;
    }
  });
  const canDraw = $derived(EDITIONS.some((kind) => data.pool[kind] > 0));
  const next = $derived({
    label: lastKind === 'GOLDEN' ? m.mod_boosters_golden() : m.mod_boosters_normal(),
    open: () => openForm?.requestSubmit(lastKind === 'GOLDEN' ? goldenButton : normalButton),
  });
</script>

<svelte:head><title>{m.mod_boosters()} — Project Achievers</title></svelte:head>

{#if opened && seen !== opened.id}
  {#key opened.id}
    <BoosterReveal
      cards={opened.cards}
      kind={opened.kind}
      {next}
      onclose={() => (seen = opened.id)}
    />
  {/key}
{/if}

<div class="mx-auto max-w-3xl space-y-6">
  <div class="space-y-1">
    <h1>{m.mod_boosters()}</h1>
    <p class="text-sm text-muted">{m.mod_boosters_intro()}</p>
    <p class="text-sm text-muted">
      {m.boosters_eligible({
        relief: data.pool.RELIEF,
        vivante: data.pool.VIVANTE,
        mythique: data.pool.MYTHIQUE,
      })}
    </p>
  </div>

  <form
    bind:this={openForm}
    method="POST"
    action="?/open"
    use:enhance={submit}
    class="card flex flex-wrap items-center gap-3 p-4"
  >
    <input type="hidden" name="pity" value={forceMythique ? MYTHIQUE_PITY - 1 : pity} />
    <button
      bind:this={normalButton}
      name="kind"
      value="NORMAL"
      class="btn btn-primary"
      disabled={!canDraw}
      onclick={() => (lastKind = 'NORMAL')}>{m.mod_boosters_normal()}</button
    >
    <button
      bind:this={goldenButton}
      name="kind"
      value="GOLDEN"
      class="btn"
      disabled={!canDraw}
      onclick={() => (lastKind = 'GOLDEN')}>{m.mod_boosters_golden()}</button
    >
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={forceMythique} disabled={!data.pool.MYTHIQUE} />
      {m.mod_boosters_force_mythique()}
    </label>
    <p class="w-full text-xs text-muted">
      {m.boosters_pity({ count: MYTHIQUE_PITY - pity })}
    </p>
  </form>

  {#if opened}
    <section class="space-y-2" aria-live="polite">
      <h2>{opened.kind === 'GOLDEN' ? m.boosters_golden() : m.boosters_opened()}</h2>
      <ul class="space-y-1 text-sm">
        {#each opened.cards as card, index (index)}
          <li data-edition={card.kind.toLowerCase()} class="trial-card">
            <span class="font-medium">{editionName[card.kind]()}</span>
            · {card.game?.name ?? '—'} ·
            <span class="text-muted">
              {card.duplicate ? m.boosters_duplicate({ count: card.shards }) : m.boosters_new()}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="space-y-3">
    <h2>{m.mod_boosters_simulation()}</h2>
    <form
      method="POST"
      action="?/simulate"
      use:enhance={submit}
      class="flex flex-wrap items-end gap-3"
    >
      <label class="space-y-1 text-sm">
        <span class="block text-muted">{m.mod_boosters_simulation_count()}</span>
        <input type="number" name="count" min="1" max="10000" value="1000" class="input w-32" />
      </label>
      <button class="btn" disabled={!canDraw}>{m.mod_boosters_simulate()}</button>
    </form>

    {#if simulation}
      {@const total = simulation.count * CARDS_PER_BOOSTER}
      <table class="w-full text-sm" aria-live="polite">
        <thead>
          <tr class="text-left text-muted">
            <th class="py-1 font-normal">{m.boosters_rate_edition()}</th>
            <th class="py-1 text-right font-normal">{m.mod_boosters_simulation_cards()}</th>
            <th class="py-1 text-right font-normal">{m.boosters_rate_chance()}</th>
          </tr>
        </thead>
        <tbody>
          {#each EDITIONS as kind (kind)}
            <tr class="border-t border-line">
              <td class="py-1">{editionName[kind]()}</td>
              <td class="py-1 text-right tabular-nums">{simulation.cards[kind]}</td>
              <td class="py-1 text-right tabular-nums">{percent(simulation.cards[kind] / total)}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="text-sm text-muted">
        {m.mod_boosters_simulation_repeated({
          count: simulation.repeated,
          total: simulation.count,
        })}
      </p>
      <p class="text-sm text-muted">
        {m.mod_boosters_simulation_forced({ count: simulation.forced })}
      </p>
    {/if}
  </section>
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
  .trial-card {
    border-left: 3px solid var(--edition);
    padding-left: 0.5rem;
  }
</style>
