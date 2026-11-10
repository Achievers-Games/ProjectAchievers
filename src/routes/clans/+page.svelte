<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import Seo from '#lib/components/Seo.svelte';
  import ActionButton from '#lib/components/ActionButton.svelte';
  import Avatar from '#lib/components/Avatar.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import { formatNumber } from '#lib/labels';

  let { data } = $props();
</script>

<Seo title="{m.clans_title()} — Project Achievers" description={m.clans_ranking_rules()} />

<div class="mx-auto max-w-2xl space-y-4">
  <div>
    <h1>{m.clans_title()}</h1>
    <p class="text-sm text-muted">{m.clans_ranking_rules()}</p>
  </div>
  {#if data.clans.length}
    <ol class="card divide-y divide-line">
      {#each data.clans as clan, index (clan.slug)}
        <li class="flex flex-wrap items-center gap-2 p-3">
          <a
            href="/clans/{clan.slug}"
            class="flex min-w-0 flex-1 items-center gap-3 hover:text-ink"
          >
            <span class="tabular w-5 text-right text-xs text-muted">{index + 1}</span>
            <Avatar name={clan.name} src={clan.image} frame={clan.frame} size={36} />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{clan.name}</span>
              <span class="block text-xs text-muted">
                {m.clan_stat_members()} : {formatNumber(clan.members)}
              </span>
            </span>
            <span class="tabular text-right text-sm">
              {formatNumber(clan.points)}
              <span class="block text-xs text-muted">{m.clans_points()}</span>
            </span>
          </a>
          {#if data.myClanId !== clan.id && !data.inClan}
            {#if data.requested.includes(clan.id)}
              <span class="text-xs text-muted">{m.clan_request_sent()}</span>
            {:else if clan.open && data.user}
              <ActionButton action="request" id={clan.id} label={m.clan_request_join()} />
            {/if}
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <Empty title={m.clans_empty()} />
  {/if}
</div>
