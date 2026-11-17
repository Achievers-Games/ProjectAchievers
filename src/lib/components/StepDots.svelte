<script lang="ts">
  import { m } from '#lib/paraglide/messages';

  interface Step {
    title: string;
    earned: boolean;
    /** Le niveau de carte du palier : Bronze, Argent, Or, Diamant, Prismatique, Légendaire. */
    tier: number;
  }

  let { steps }: { steps: Step[] } = $props();

  const done = $derived(steps.filter((step) => step.earned).length);
  /** Le premier palier manquant est celui à viser. */
  const next = $derived(steps.findIndex((step) => !step.earned));
</script>

<ol class="mt-1.5 flex flex-wrap items-center gap-1" aria-label={m.ach_steps_label()}>
  {#each steps as step, at (at)}
    <li
      class="step"
      data-tier={step.tier || undefined}
      class:earned={step.earned}
      class:current={at === next}
      title={step.title}
    >
      <span class="sr-only">{step.title}{step.earned ? ' ✓' : ''}</span>
    </li>
  {/each}
  <li class="ml-1 text-xs text-muted">{m.ach_steps({ done, total: steps.length })}</li>
</ol>

<style>
  /* Un point par palier, de la couleur de son niveau : plein une fois obtenu, cerclé pour celui à viser. */
  .step {
    --dot: rgb(var(--muted));
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 9999px;
    border: 1.5px solid var(--dot);
    opacity: 0.75;
  }
  .step[data-tier] {
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
</style>
