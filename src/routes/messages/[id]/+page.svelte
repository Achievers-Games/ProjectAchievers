<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import Conversation from '$lib/components/Conversation.svelte';

  let { data } = $props();
  const me = $derived(data.user?.id ?? '');
</script>

<svelte:head><title>{data.title} — Project Achievers</title></svelte:head>

<div class="chat-page card mx-auto flex max-w-2xl flex-col overflow-hidden">
  <header class="flex items-center gap-2 border-b border-line p-3">
    <a href="/messages" class="text-muted hover:text-ink" aria-label={m.nav_messages()}>
      <ChevronLeft size={18} aria-hidden="true" />
    </a>
    <h1 class="truncate text-base">{data.title}</h1>
  </header>
  <div class="min-h-0 flex-1">
    {#key data.id}<Conversation id={data.id} {me} />{/key}
  </div>
</div>
