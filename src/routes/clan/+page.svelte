<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import ActionButton from '$lib/components/ActionButton.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import SocialNav from '$lib/components/SocialNav.svelte';
  import { submitWithToast } from '$lib/forms';

  let { data } = $props();
  const submit = submitWithToast();
</script>

<svelte:head><title>{m.nav_clan()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <h1>{data.membership?.clan.name ?? m.nav_clan()}</h1>
  <SocialNav />
  <a href="/clans" class="text-sm text-muted hover:text-ink">{m.clans_all()}</a>

  {#if data.invites.length}
    <section class="space-y-2">
      <h2>{m.clan_invites()}</h2>
      <ul class="card divide-y divide-line">
        {#each data.invites as clan (clan.id)}
          <li class="flex flex-wrap items-center gap-2 p-3">
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{clan.name}</span>
            <ActionButton action="accept" id={clan.id} label={m.clan_join()} />
            <ActionButton action="decline" id={clan.id} label={m.friend_decline()} />
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if data.membership?.clan.flaggedName}
    {#if data.membership.owner}
      <section class="card space-y-3 border-danger/60 p-4" data-testid="clan-rename">
        <h2 class="text-base">{m.clan_rename_title()}</h2>
        <p class="text-sm text-muted">
          {m.clan_rename_text({ name: data.membership.clan.flaggedName })}
        </p>
        <form method="POST" action="?/rename" use:enhance={submit} class="flex gap-2">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            name="name"
            required
            minlength="3"
            maxlength="32"
            autofocus
            aria-label={m.clan_rename_label()}
            placeholder={m.clan_rename_label()}
            class="input flex-1"
          />
          <button class="btn btn-primary">{m.clan_rename_action()}</button>
        </form>
      </section>
    {:else}
      <p class="card p-3 text-sm text-muted">{m.clan_rename_waiting()}</p>
    {/if}
  {/if}

  {#if data.membership}
    <div class="flex flex-wrap gap-2">
      <a class="btn" href="/clans/{data.membership.clan.slug}">{m.clan_public_page()}</a>
      <form method="POST" action="?/discussion" use:enhance={submit}>
        <button class="btn btn-primary">{m.clan_discussion()}</button>
      </form>
      <form method="POST" action="?/leave" use:enhance={submit}>
        <button class="btn btn-danger">{m.clan_leave()}</button>
      </form>
    </div>

    <section class="space-y-2">
      <h2>{m.clan_members()}</h2>
      <ul class="card divide-y divide-line">
        {#each data.membership.clan.members as member (member.user.id)}
          <li class="flex items-center gap-2 p-3">
            <a href="/u/{member.user.handle}" class="flex min-w-0 flex-1 items-center gap-3">
              <Avatar person={member.user} size={36} />
              <span class="truncate text-sm font-medium">{member.user.displayName}</span>
            </a>
            {#if member.owner}
              <span class="text-xs text-muted">{m.clan_owner()}</span>
            {:else if data.membership.owner}
              <ActionButton action="kick" id={member.user.id} label={m.clan_kick()} danger />
            {/if}
          </li>
        {/each}
      </ul>
    </section>

    {#if data.invitable.length}
      <section class="space-y-2">
        <h2>{m.clan_invite()}</h2>
        <ul class="card divide-y divide-line">
          {#each data.invitable as friend (friend.id)}
            <li class="flex items-center gap-2 p-3">
              <Avatar person={friend} size={36} />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{friend.displayName}</span>
              <ActionButton action="invite" id={friend.id} label={m.clan_invite_action()} />
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {:else}
    <Empty title={m.clan_none()}>{m.clan_none_text()}</Empty>
    <form method="POST" action="?/create" use:enhance={submit} class="flex gap-2">
      <input
        name="name"
        required
        minlength="3"
        maxlength="32"
        aria-label={m.clan_name()}
        placeholder={m.clan_name()}
        class="input flex-1"
      />
      <button class="btn btn-primary">{m.clan_create()}</button>
    </form>
  {/if}
</div>
