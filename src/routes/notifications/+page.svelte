<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { m } from '#lib/paraglide/messages';
  import NoticeRow from '#lib/components/NoticeRow.svelte';

  let { data } = $props();
  let marking = $state(false);
  const hasUnread = $derived(data.items.some((item) => item.unread));

  async function markAll() {
    marking = true;
    await fetch('/api/notifications', { method: 'PUT' }).catch(() => null);
    await invalidate('app:notices');
    marking = false;
  }
</script>

<svelte:head>
  <title>{m.notifications_title()} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-2xl space-y-4">
  <div class="flex items-center justify-between gap-3">
    <h1>{m.notifications_title()}</h1>
    <button
      type="button"
      class="btn btn-secondary"
      onclick={markAll}
      disabled={!hasUnread || marking}
    >
      {m.notifications_mark_all()}
    </button>
  </div>
  <div class="card p-1">
    {#if !data.items.length}
      <p class="px-2 py-6 text-center text-sm text-muted">{m.notifications_empty()}</p>
    {:else}
      {#each data.items as notice (notice.id)}
        <NoticeRow {notice} />
      {/each}
    {/if}
  </div>
  <p class="text-xs text-muted">{m.notifications_page_hint()}</p>
</div>
