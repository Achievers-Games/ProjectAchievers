<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import Plus from '@lucide/svelte/icons/plus';
  import Avatar from './Avatar.svelte';
  import { toast } from '#lib/stores/toast';

  interface Friend {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    frame: string | null;
  }

  /** Choisit un ami et ouvre la discussion avec lui, qu'elle existe déjà ou non. */
  let {
    onOpen,
    compact = false,
  }: {
    onOpen: (conversation: { id: string; title: string; handle: string }) => void;
    /** Dans la fenêtre de discussion, le bouton prend toute la largeur. */
    compact?: boolean;
  } = $props();

  let open = $state(false);
  let friends = $state<Friend[] | null>(null);
  let filter = $state('');
  let busy = $state(false);

  const shown = $derived(
    (friends ?? []).filter((friend) =>
      `${friend.displayName} ${friend.handle}`.toLowerCase().includes(filter.trim().toLowerCase()),
    ),
  );

  async function toggle() {
    open = !open;
    if (!open || friends) return;
    const response = await fetch('/api/messages/contacts').catch(() => null);
    friends = response?.ok ? ((await response.json()) as Friend[]) : [];
  }

  async function start(friend: Friend) {
    if (busy) return;
    busy = true;
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: friend.id }),
    }).catch(() => null);
    busy = false;
    if (!response?.ok) {
      toast(m.chat_not_friends(), 'error');
      return;
    }
    const { id } = (await response.json()) as { id: string };
    open = false;
    filter = '';
    onOpen({ id, title: friend.displayName, handle: friend.handle });
  }
</script>

<div class:w-full={compact}>
  <button
    type="button"
    class={compact
      ? 'flex w-full items-center gap-2 p-2 text-left text-sm font-medium hover:bg-raised'
      : 'btn btn-primary'}
    aria-expanded={open}
    onclick={toggle}
  >
    <Plus size={16} aria-hidden="true" />
    {m.chat_new()}
  </button>

  {#if open}
    <div class="space-y-2 p-2" class:card={!compact} class:mt-2={!compact}>
      {#if friends === null}
        <p class="p-2 text-sm text-muted">{m.chat_new_loading()}</p>
      {:else if friends.length === 0}
        <p class="p-2 text-sm text-muted">
          {m.chat_new_no_friends()}
          <a href="/amis" class="text-accent underline">{m.nav_friends()}</a>
        </p>
      {:else}
        <input
          bind:value={filter}
          type="search"
          class="input"
          placeholder={m.chat_new_filter()}
          aria-label={m.chat_new_filter()}
        />
        <ul class="max-h-60 overflow-y-auto">
          {#each shown as friend (friend.id)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-raised disabled:opacity-50"
                disabled={busy}
                onclick={() => start(friend)}
              >
                <Avatar person={friend} size={28} />
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{friend.displayName}</span>
                  <span class="block truncate text-xs text-muted">@{friend.handle}</span>
                </span>
              </button>
            </li>
          {:else}
            <li class="p-2 text-sm text-muted">{m.chat_new_none()}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
