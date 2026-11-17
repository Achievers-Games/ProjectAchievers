<script lang="ts" module>
  import type { Provider } from '#prisma';

  export interface PlaytimeLine {
    key: string;
    provider: Provider;
    /** La console, quand un compte en couvre plusieurs (PS4, PS5). */
    console: string | null;
    hours: string;
    href: string | null;
    name: string;
  }
</script>

<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ProviderIcon from './ProviderIcon.svelte';

  /**
   * Le temps de jeu total, qui détaille ses heures par plateforme au survol, au clavier ou d'un
   * clic (sur téléphone). Chaque ligne du détail mène au profil du compte sur sa plateforme.
   */
  let { total, lines }: { total: string; lines: PlaytimeLine[] } = $props();

  let open = $state(false);
  /** Ouvert d'un clic : il reste ouvert quand la souris s'en va, jusqu'au clic suivant. */
  let pinned = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();
  /** L'en-tête du profil coupe ce qui dépasse : le détail se place par rapport à la fenêtre. */
  let place = $state({ top: 0, left: 0 });
  let leaving: ReturnType<typeof setTimeout> | undefined;
  /** La largeur du détail en pixels : 13rem, et la racine grandit sur les grands écrans. */
  const panelWidth = () => 13 * parseFloat(getComputedStyle(document.documentElement).fontSize);

  function show() {
    clearTimeout(leaving);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // À droite du total s'il y a la place, pour laisser visibles les icônes des comptes juste
    // dessous ; sinon (téléphone), en dessous.
    place =
      rect.right + panelWidth() + 16 <= document.documentElement.clientWidth
        ? { top: rect.top - 6, left: rect.right + 10 }
        : { top: rect.bottom + 6, left: rect.left };
    open = true;
  }

  function hide() {
    open = false;
    pinned = false;
  }

  /** Un court délai laisse le temps de passer du total au détail sans qu'il se ferme. */
  function leave() {
    if (pinned) return;
    leaving = setTimeout(hide, 150);
  }

  function toggle() {
    if (pinned) return hide();
    show();
    pinned = true;
  }
</script>

<svelte:window
  onpointerdown={(event) => {
    if (!open) return;
    const target = event.target as Node;
    if (panel?.contains(target) || trigger?.contains(target)) return;
    hide();
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && open) {
      hide();
      trigger?.focus();
    }
  }}
  onscrollcapture={() => open && hide()}
  onresize={() => open && hide()}
/>

<button
  bind:this={trigger}
  type="button"
  class="playtime-total"
  aria-expanded={open}
  aria-controls="playtime-breakdown"
  data-testid="profile-playtime"
  onclick={toggle}
  onpointerenter={(event) => event.pointerType === 'mouse' && show()}
  onpointerleave={(event) => event.pointerType === 'mouse' && leave()}
  onfocus={show}
  onblur={(event) => {
    if (!panel?.contains(event.relatedTarget as Node)) leave();
  }}
>
  {total}
  <ChevronDown
    size={14}
    class="transition-transform {open ? 'rotate-180' : ''}"
    aria-hidden="true"
  />
</button>

{#if open}
  <div
    bind:this={panel}
    id="playtime-breakdown"
    class="playtime-panel"
    style:top="{place.top}px"
    style:left="{place.left}px"
    role="group"
    aria-label={total}
    onpointerenter={() => clearTimeout(leaving)}
    onpointerleave={(event) => event.pointerType === 'mouse' && leave()}
    onfocusout={(event) => {
      if (!panel?.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger) leave();
    }}
  >
    <ul>
      {#each lines as line (line.key)}
        <li>
          <svelte:element
            this={line.href ? 'a' : 'span'}
            href={line.href ?? undefined}
            target={line.href ? '_blank' : undefined}
            rel={line.href ? 'noopener noreferrer' : undefined}
            class="playtime-line"
            aria-label={line.href ? `${line.name} : ${line.hours}` : undefined}
          >
            <ProviderIcon provider={line.provider} />
            {#if line.console}<span class="text-xs font-semibold">{line.console}</span>{/if}
            <span class="tabular ml-auto pl-6 text-ink">{line.hours}</span>
          </svelte:element>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .playtime-total {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-ink);
    text-decoration: underline dotted rgb(255 255 255 / 0.35);
    text-underline-offset: 4px;
  }
  .playtime-total:hover,
  .playtime-total[aria-expanded='true'] {
    text-decoration-color: currentColor;
  }
  .playtime-panel {
    position: fixed;
    z-index: 50;
    width: 13rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-line);
    background: var(--color-surface);
    padding: 0.375rem;
    box-shadow: 0 10px 28px rgb(0 0 0 / 0.45);
  }
  .playtime-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 0.375rem;
    padding: 0.375rem 0.5rem;
    font-size: 0.875rem;
    color: var(--color-muted);
  }
  a.playtime-line:hover,
  a.playtime-line:focus-visible {
    background: var(--color-raised);
    color: var(--color-ink);
    outline: none;
  }
</style>
