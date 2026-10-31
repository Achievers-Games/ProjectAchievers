<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import SocialNav from '$lib/components/SocialNav.svelte';
  import { submitWithToast } from '$lib/forms';

  let { data } = $props();
  const submit = submitWithToast();
</script>

<svelte:head><title>{m.nav_friends()} — Project Achievers</title></svelte:head>

{#snippet action(name: string, id: string, label: string, danger = false)}
  <form method="POST" action="?/{name}" use:enhance={submit}>
    <input type="hidden" name="id" value={id} />
    <button class="btn h-8" class:btn-danger={danger}>{label}</button>
  </form>
{/snippet}

{#snippet person(user: (typeof data.friends)[number])}
  <a href="/u/{user.handle}" class="flex min-w-0 flex-1 items-center gap-3">
    <Avatar person={user} size={36} />
    <span class="truncate text-sm font-medium">{user.displayName}</span>
  </a>
{/snippet}

<div class="mx-auto max-w-2xl space-y-6">
  <h1>{m.nav_friends()}</h1>
  <SocialNav />

  <form method="POST" action="?/add" use:enhance={submit} class="flex gap-2">
    <input
      name="handle"
      required
      maxlength="24"
      autocomplete="off"
      aria-label={m.friend_handle()}
      placeholder={m.friend_handle()}
      class="input flex-1"
    />
    <button class="btn btn-primary">{m.friend_add()}</button>
  </form>

  {#if data.received.length}
    <section class="space-y-2">
      <h2>{m.friends_received()}</h2>
      <ul class="card divide-y divide-line">
        {#each data.received as user (user.id)}
          <li class="flex flex-wrap items-center gap-2 p-3">
            {@render person(user)}
            {@render action('accept', user.id, m.friend_accept())}
            {@render action('remove', user.id, m.friend_decline())}
            {@render action('block', user.id, m.friend_block(), true)}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="space-y-2">
    <h2>{m.friends_list()}</h2>
    {#if data.friends.length}
      <ul class="card divide-y divide-line">
        {#each data.friends as user (user.id)}
          <li class="flex flex-wrap items-center gap-2 p-3">
            {@render person(user)}
            {@render action('message', user.id, m.friend_message())}
            {@render action('remove', user.id, m.friend_remove())}
            {@render action('block', user.id, m.friend_block(), true)}
          </li>
        {/each}
      </ul>
    {:else}
      <Empty title={m.friends_empty()}>{m.friends_empty_text()}</Empty>
    {/if}
  </section>

  {#if data.sent.length}
    <section class="space-y-2">
      <h2>{m.friends_sent()}</h2>
      <ul class="card divide-y divide-line">
        {#each data.sent as user (user.id)}
          <li class="flex items-center gap-2 p-3">
            {@render person(user)}
            {@render action('remove', user.id, m.cancel())}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if data.blocked.length}
    <section class="space-y-2">
      <h2>{m.friends_blocked()}</h2>
      <ul class="card divide-y divide-line">
        {#each data.blocked as user (user.id)}
          <li class="flex items-center gap-2 p-3">
            {@render person(user)}
            {@render action('unblock', user.id, m.friend_unblock())}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
