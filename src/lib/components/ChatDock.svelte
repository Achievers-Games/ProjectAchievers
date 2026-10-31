<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import X from '@lucide/svelte/icons/x';
  import Avatar from './Avatar.svelte';
  import Conversation from './Conversation.svelte';
  import {
    closeChat,
    dockChats,
    hasDock,
    incoming,
    openChat,
    persistChats,
    renameChat,
    unread,
  } from '$lib/stores/chat';

  interface Row {
    id: string;
    title: string;
    person: { displayName: string; avatarUrl: string | null; handle: string } | null;
    preview: string;
    unread: number;
  }

  let { me }: { me: string } = $props();

  let shown = $state(false);
  let listOpen = $state(false);
  let rows = $state<Row[]>([]);

  onMount(() => {
    shown = hasDock();
    if (!shown) return;
    const stopSaving = persistChats(me);
    // Comme sur Messenger : un message reçu ouvre sa discussion.
    const stopListening = incoming.subscribe((event) => {
      if (!event || event.message.author.id === me) return;
      openChat(event.conversationId, event.message.author.displayName);
    });
    return () => {
      stopSaving();
      stopListening();
    };
  });

  async function toggleList() {
    listOpen = !listOpen;
    if (!listOpen) return;
    const response = await fetch('/api/messages').catch(() => null);
    if (response?.ok) rows = (await response.json()) as Row[];
  }

  function open(row: Row) {
    listOpen = false;
    unread.update((count) => Math.max(0, count - row.unread));
    openChat(row.id, row.title);
  }
</script>

{#if shown}<div class="fixed bottom-0 right-4 z-30 hidden items-end gap-2 md:flex">
    {#each $dockChats as chat (chat.id)}
      <section class="card w-72 overflow-hidden rounded-b-none shadow-lg" aria-label={chat.title}>
        <header class="flex items-center gap-2 border-b border-line px-3 py-2">
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left text-sm font-medium"
            aria-expanded={!chat.folded}
            onclick={() => openChat(chat.id, chat.title, !chat.folded)}
          >
            {chat.title}
          </button>
          <button
            type="button"
            class="text-muted hover:text-ink"
            aria-label={m.chat_close()}
            onclick={() => closeChat(chat.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        {#if !chat.folded}
          <div class="h-80">
            <Conversation id={chat.id} {me} onTitle={(title) => renameChat(chat.id, title)} />
          </div>
        {/if}
      </section>
    {/each}

    <div class="w-64">
      {#if listOpen}
        <ul class="card max-h-96 divide-y divide-line overflow-y-auto rounded-b-none shadow-lg">
          {#each rows as row (row.id)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2 p-2 text-left hover:bg-raised"
                onclick={() => open(row)}
              >
                <Avatar
                  name={row.title}
                  src={row.person?.avatarUrl}
                  person={row.person}
                  size={28}
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{row.title}</span>
                  <span class="block truncate text-xs text-muted">{row.preview}</span>
                </span>
                {#if row.unread}<span class="social-badge">{row.unread}</span>{/if}
              </button>
            </li>
          {:else}
            <li class="p-4 text-center text-sm text-muted">{m.chat_none()}</li>
          {/each}
        </ul>
      {/if}
      <button
        type="button"
        class="card flex w-full items-center gap-2 rounded-b-none px-3 py-2 text-sm font-medium shadow-lg"
        aria-expanded={listOpen}
        onclick={toggleList}
      >
        <MessageCircle size={15} aria-hidden="true" />
        {m.nav_messages()}
        {#if $unread}<span class="social-badge ml-auto">{$unread}</span>{/if}
      </button>
    </div>
  </div>{/if}
