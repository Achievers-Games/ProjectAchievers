<script lang="ts">
  import { m } from '#lib/paraglide/messages';

  interface Step {
    title: string;
    text?: string | null;
    earned: boolean;
    /** Le niveau de carte du palier : Bronze, Argent, Or, Diamant, Prismatique, Légendaire. */
    tier: number;
  }

  let { steps }: { steps: Step[] } = $props();

  const done = $derived(steps.filter((step) => step.earned).length);
  /** Le premier palier manquant est celui à viser. */
  const next = $derived(steps.findIndex((step) => !step.earned));
  let selected = $state<number | null>(null);
</script>

<ol class="mt-1.5 flex flex-wrap items-center gap-1" aria-label={m.ach_steps_label()}>
  {#each steps as step, at (at)}
    <li data-tier={step.tier || undefined}>
      {#snippet dot()}
        <span class="step" class:earned={step.earned} class:current={at === next} aria-hidden="true"
        ></span>
        <span class="sr-only">{step.text ?? step.title}{step.earned ? ' ✓' : ''}</span>
      {/snippet}
      {#if step.text}
        <button
          type="button"
          class="step-button"
          title={step.text}
          aria-pressed={selected === at}
          onclick={() => (selected = selected === at ? null : at)}>{@render dot()}</button
        >
      {:else}
        <span title={step.title}>{@render dot()}</span>
      {/if}
    </li>
  {/each}
  <li class="ml-1 text-xs text-muted">{m.ach_steps({ done, total: steps.length })}</li>
</ol>
{#if selected !== null && steps[selected]?.text}
  <p class="mt-1 text-xs text-muted" aria-live="polite">
    <strong class="text-ink">{steps[selected]?.title}</strong> · {steps[selected]?.text}
  </p>
{/if}

<style>
  /* Un point par palier, de la couleur de son niveau : plein une fois obtenu, cerclé pour celui à viser. */
  .step {
    --dot: rgb(var(--muted));
    display: block;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 9999px;
    border: 1.5px solid var(--dot);
    opacity: 0.75;
  }
  li[data-tier] .step {
    --dot: var(--tier-ink);
  }
  .step.earned {
    background: var(--dot);
    opacity: 1;
  }
  .step.current {
    opacity: 1;
    box-shadow: 0 0 0 2px rgb(var(--ink) / 0.35);
  }
  .step-button {
    display: grid;
    min-width: 1.5rem;
    min-height: 1.5rem;
    place-items: center;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .step-button:hover,
  .step-button[aria-pressed='true'] {
    background-color: rgb(var(--raised));
  }
</style>
