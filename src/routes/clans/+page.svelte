<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import { formatNumber } from '$lib/labels';

  let { data } = $props();
</script>

<svelte:head><title>{m.clans_title()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-4">
  <h1>{m.clans_title()}</h1>
  {#if data.clans.length}
    <ol class="card divide-y divide-line">
      {#each data.clans as clan, index (clan.slug)}
        <li>
          <a href="/clans/{clan.slug}" class="flex items-center gap-3 p-3 hover:bg-raised">
            <span class="tabular w-5 text-right text-xs text-muted">{index + 1}</span>
            <Avatar name={clan.name} src={clan.image} frame={clan.frame} size={36} />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{clan.name}</span>
              <span class="block text-xs text-muted">
                {m.clan_stat_members()} : {formatNumber(clan.members)}
              </span>
            </span>
            <span class="tabular text-sm">{formatNumber(clan.achievements)}</span>
          </a>
        </li>
      {/each}
    </ol>
  {:else}
    <Empty title={m.clans_empty()} />
  {/if}
</div>
