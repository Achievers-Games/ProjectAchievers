<script lang="ts">
  import Smile from '@lucide/svelte/icons/smile';
  import { m } from '#lib/paraglide/messages';

  let { onPick }: { onPick: (emoji: string) => void } = $props();

  /**
   * Une poignée d'emojis courants, sans bibliothèque : le clavier du téléphone et le sélecteur du
   * système (Win + . ou Ctrl + Cmd + Espace) donnent tout le reste, directement dans le champ.
   */
  const EMOJIS = [
    '😀 😄 😂 🤣 😊 😍 😎 🤩',
    '😉 😜 🤔 😏 😅 😭 😱 😡',
    '🥳 😴 🙄 🤯 🥲 😬 🤗 🫡',
    '👍 👎 👏 🙌 🙏 💪 👀 🤝',
    '❤️ 💔 🔥 ✨ 💯 🎉 ⭐ 💀',
    '🏆 🥇 🎮 🕹️ 🎯 🦀 👑 💎',
  ]
    .join(' ')
    .split(' ');

  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();

  function pick(emoji: string) {
    onPick(emoji);
    open = false;
  }

  function dismiss({ focus }: { focus: boolean }) {
    open = false;
    if (focus) button?.focus();
  }

  $effect(() => {
    if (open) panel?.querySelector('button')?.focus();
  });
</script>

<svelte:window
  onpointerdown={(event) => {
    if (!open) return;
    const target = event.target as Node;
    if (panel?.contains(target) || button?.contains(target)) return;
    dismiss({ focus: false });
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && open) dismiss({ focus: true });
  }}
/>

<button
  bind:this={button}
  type="button"
  class="btn w-9 shrink-0 px-0 text-muted"
  onclick={() => (open = !open)}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-label={m.chat_emoji()}
  title={m.chat_emoji()}
>
  <Smile size={16} aria-hidden="true" />
</button>

{#if open}
  <div
    bind:this={panel}
    role="dialog"
    aria-label={m.chat_emoji()}
    class="absolute inset-x-2 bottom-full z-20 mb-1 grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto rounded-md border border-line bg-surface p-1.5 shadow-lg"
  >
    {#each EMOJIS as emoji (emoji)}
      <button
        type="button"
        class="aspect-square rounded text-lg leading-none hover:bg-raised focus-visible:bg-raised"
        onclick={() => pick(emoji)}
      >
        {emoji}
      </button>
    {/each}
  </div>
{/if}
