<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Avatar from '$lib/components/Avatar.svelte';
  import { formatDate, formatNumber } from '$lib/labels';

  let { data } = $props();
  const clan = $derived(data.clan);
</script>

<svelte:head>
  <title>{clan.name} — Project Achievers</title>
  <meta
    name="description"
    content="{clan.name} : {m.count_achievements({ count: clan.achievements })}"
  />
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <header class="space-y-1">
    <a href="/clans" class="text-sm text-muted hover:text-ink">{m.clans_title()}</a>
    <h1>{clan.name}</h1>
    <p class="text-sm text-muted">{m.clan_founded({ date: formatDate(clan.createdAt) })}</p>
    {#if data.moderator}
      <form method="POST" action="?/flagName" use:enhance>
        <button class="btn btn-danger text-xs" title={m.clan_flag_help()}>
          {m.clan_flag()}
        </button>
      </form>
    {/if}
  </header>

  <dl class="card grid grid-cols-2 divide-x divide-line">
    <div class="p-4">
      <dt class="label">{m.clan_stat_members()}</dt>
      <dd class="stat-value tabular mt-1">{formatNumber(clan.members.length)}</dd>
    </div>
    <div class="p-4">
      <dt class="label">{m.clan_stat_achievements()}</dt>
      <dd class="stat-value tabular mt-1">{formatNumber(clan.achievements)}</dd>
    </div>
  </dl>

  <section class="space-y-2">
    <h2>{m.clan_members()}</h2>
    <ol class="card divide-y divide-line">
      {#each clan.members as member (member.user.handle)}
        <li>
          <a href="/u/{member.user.handle}" class="flex items-center gap-3 p-3 hover:bg-raised">
            <Avatar person={member.user} size={36} />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">
              {member.user.displayName}
            </span>
            {#if member.owner}<span class="text-xs text-muted">{m.clan_owner()}</span>{/if}
            <span class="tabular text-sm">{formatNumber(member.achievements)}</span>
          </a>
        </li>
      {/each}
    </ol>
  </section>
</div>
