<script lang="ts">
  import { displayText } from '$lib/profanity';
  import { m } from '$lib/paraglide/messages';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import SocialNav from '$lib/components/SocialNav.svelte';
  import { formatRelative } from '$lib/labels';

  let { data } = $props();
</script>

<svelte:head><title>{m.nav_messages()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-4">
  <h1>{m.nav_messages()}</h1>
  <SocialNav />
  {#if data.conversations.length}
    <ul class="card divide-y divide-line">
      {#each data.conversations as row (row.id)}
        <li>
          <a href="/messages/{row.id}" class="flex items-center gap-3 p-3 hover:bg-raised">
            <Avatar name={row.title} person={row.person} size={40} />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{row.title}</span>
              <span class="block truncate text-sm text-muted"
                >{displayText(row.preview, data.user?.allowProfanity, row.previewLocale)}</span
              >
            </span>
            <span class="shrink-0 text-right text-xs text-muted">
              {#if row.at}{formatRelative(row.at)}{/if}
              {#if row.unread}<span class="social-badge mt-1 block">{row.unread}</span>{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <Empty title={m.chat_none()}>{m.chat_none_text()}</Empty>
  {/if}
</div>
