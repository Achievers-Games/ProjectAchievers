<script lang="ts">
  import { page } from '$app/state';
  import { displayText } from '$lib/profanity';
  import { m } from '$lib/paraglide/messages';
  import { onMount, tick } from 'svelte';
  import Flag from '@lucide/svelte/icons/flag';
  import Avatar from './Avatar.svelte';
  import type { ChatEvent } from '$lib/server/sync/events';
  import { sendJson } from '$lib/http';
  import { incoming, unread } from '$lib/stores/chat';
  import { toast } from '$lib/stores/toast';

  type Message = ChatEvent['message'];

  let {
    id,
    me,
    onTitle,
    onGone,
  }: {
    id: string;
    me: string;
    onTitle?: (title: string) => void;
    /** La discussion n'existe plus pour ce joueur : clan quitté, par exemple. */
    onGone?: () => void;
  } = $props();

  let messages = $state<Message[]>([]);
  let draft = $state('');
  let sending = $state(false);
  let list = $state<HTMLElement>();

  const scrollDown = async () => {
    await tick();
    list?.scrollTo({ top: list.scrollHeight });
  };

  function add(message: Message) {
    if (messages.some((known) => known.id === message.id)) return;
    messages.push(message);
    void scrollDown();
  }

  onMount(() => {
    void load();
    return incoming.subscribe((event) => {
      if (event?.conversationId !== id) return;
      add(event.message);
      void fetch(`/api/messages/${id}`, { method: 'PUT' }).catch(() => {});
    });
  });

  const shown = ({ content, locale }: Message) =>
    displayText(content, page.data.user?.allowProfanity, locale);

  async function load() {
    const response = await fetch(`/api/messages/${id}`).catch(() => null);
    if (response?.status === 404) onGone?.();
    if (!response?.ok) return;
    const conversation = (await response.json()) as {
      title: string;
      messages: Message[];
      unread: number;
    };
    messages = conversation.messages;
    unread.set(conversation.unread);
    onTitle?.(conversation.title);
    void scrollDown();
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    sending = true;
    const response = await sendJson(`/api/messages/${id}`, { content });
    sending = false;
    if (response?.ok) {
      draft = '';
      add((await response.json()) as Message);
      return;
    }
    const failure = (await response?.json().catch(() => null)) as { message?: string } | null;
    toast(failure?.message ?? m.action_failed(), 'error');
  }

  async function report(message: Message) {
    const reason = prompt(m.report_prompt());
    if (!reason) return;
    const response = await sendJson('/api/messages/signalement', {
      messageId: message.id,
      reason,
    });
    if (response?.ok) toast(m.report_sent());
    else toast(m.report_failed(), 'error');
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <ul bind:this={list} class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
    {#each messages as message (message.id)}
      <li class="group flex gap-2" class:flex-row-reverse={message.author.id === me}>
        <a
          href="/u/{message.author.handle}"
          class="h-fit shrink-0"
          aria-label={message.author.displayName}
        >
          <Avatar person={message.author} size={24} />
        </a>
        <p
          class="max-w-[75%] whitespace-pre-wrap break-words rounded px-2 py-1 text-sm"
          class:bg-raised={message.author.id !== me}
          class:bg-accent={message.author.id === me}
          class:text-on-accent={message.author.id === me}
        >
          {shown(message)}
        </p>
        {#if message.author.id !== me}
          <button
            type="button"
            class="self-center text-muted opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100"
            aria-label={m.report()}
            onclick={() => report(message)}
          >
            <Flag size={12} aria-hidden="true" />
          </button>
        {/if}
      </li>
    {:else}
      <li class="p-4 text-center text-sm text-muted">{m.chat_empty()}</li>
    {/each}
  </ul>
  <form onsubmit={send} class="flex gap-2 border-t border-line p-2">
    <textarea
      bind:value={draft}
      onkeydown={onKeydown}
      rows="1"
      maxlength="2000"
      aria-label={m.chat_placeholder()}
      placeholder={m.chat_placeholder()}
      class="input h-auto min-h-9 flex-1 resize-none py-1.5"></textarea>
    <button class="btn btn-primary" disabled={sending || !draft.trim()}>{m.chat_send()}</button>
  </form>
</div>
