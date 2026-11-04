<script lang="ts">
  import { m } from '#lib/paraglide/messages';

  interface Step {
    title: string;
    earned: boolean;
    level: number;
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
      data-level={step.level || undefined}
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
  /* Un point par palier : plein une fois obtenu, cerclé pour celui à viser. */
  .step {
    --ring: var(--muted);
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 9999px;
    border: 1.5px solid rgb(var(--ring) / 0.7);
  }
  .step[data-level='1'] {
    --ring: var(--bronze);
  }
  .step[data-level='2'] {
    --ring: var(--silver);
  }
  .step[data-level='3'] {
    --ring: var(--gold);
  }
  .step.earned {
    background: rgb(var(--ring));
    border-color: rgb(var(--ring));
  }
  .step.current {
    box-shadow: 0 0 0 2px rgb(var(--ink) / 0.35);
  }
</style>
