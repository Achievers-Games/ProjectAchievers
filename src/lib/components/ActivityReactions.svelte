<script lang="ts">
  import type { ActivityEmoji } from '#prisma';
  import { ACTIVITY_EMOJIS, type ActivityReactions } from '#lib/activity';
  import { m } from '#lib/paraglide/messages';
  import { toast } from '#lib/stores/toast';
  import SmilePlus from '@lucide/svelte/icons/smile-plus';

  let {
    kind,
    handle,
    id,
    summary,
    signedIn,
  }: {
    kind: 'card' | 'unlock';
    handle: string;
    id: string;
    summary?: ActivityReactions;
    signedIn: boolean;
  } = $props();

  const choices: Record<ActivityEmoji, { icon: string; label: () => string }> = {
    CLAP: { icon: '👏', label: m.activity_clap },
    FIRE: { icon: '🔥', label: m.activity_fire },
    HEART: { icon: '❤️', label: m.activity_heart },
    WOW: { icon: '😮', label: m.activity_wow },
    LAUGH: { icon: '😂', label: m.activity_laugh },
    TROPHY: { icon: '🏆', label: m.activity_trophy },
    STRONG: { icon: '💪', label: m.activity_strong },
    SAD: { icon: '😢', label: m.activity_sad },
  };
  let saved = $state<ActivityReactions>();
  const current = $derived(saved ?? summary);
  // Seules les réactions déjà données s'affichent ; les autres attendent dans le menu.
  const given = $derived(ACTIVITY_EMOJIS.filter((emoji) => (current?.counts[emoji] ?? 0) > 0));
  let pending = $state(false);
  let open = $state(false);
  let root = $state<HTMLElement>();

  async function react(emoji: ActivityEmoji) {
    open = false;
    pending = true;
    try {
      const response = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, handle, id, emoji, active: current?.mine !== emoji }),
      });
      if (!response.ok) throw new Error(String(response.status));
      saved = (await response.json()) as ActivityReactions;
    } catch {
      toast(m.action_failed(), 'error');
    } finally {
      pending = false;
    }
  }

  // Le menu se ferme au clic ailleurs ou sur Échap, comme sur une messagerie.
  $effect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false;
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });
</script>

{#if signedIn || given.length}
  <div
    bind:this={root}
    class="relative flex flex-wrap items-center gap-1"
    role="group"
    aria-label={m.activity_reactions()}
  >
    {#each given as emoji (emoji)}
      {@const choice = choices[emoji]}
      {@const count = current?.counts[emoji] ?? 0}
      {#if signedIn}
        <button
          type="button"
          class="reaction"
          class:reaction-active={current?.mine === emoji}
          aria-pressed={current?.mine === emoji}
          aria-label={`${choice.label()} · ${count}`}
          title={choice.label()}
          disabled={pending}
          onclick={() => react(emoji)}
        >
          {choice.icon}&nbsp;{count}
        </button>
      {:else}
        <span class="reaction" title={choice.label()}>{choice.icon}&nbsp;{count}</span>
      {/if}
    {/each}
    {#if signedIn}
      <button
        type="button"
        class="reaction reaction-add"
        aria-label={m.activity_more()}
        title={m.activity_more()}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={pending}
        onclick={() => (open = !open)}
      >
        <SmilePlus size={16} aria-hidden="true" />
      </button>
      {#if open}
        <div class="reaction-menu" role="menu" aria-label={m.activity_reactions()}>
          {#each ACTIVITY_EMOJIS as emoji (emoji)}
            {@const choice = choices[emoji]}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={current?.mine === emoji}
              class="reaction-pick"
              class:reaction-active={current?.mine === emoji}
              aria-label={choice.label()}
              title={choice.label()}
              onclick={() => react(emoji)}
            >
              {choice.icon}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}
