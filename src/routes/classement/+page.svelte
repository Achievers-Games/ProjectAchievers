<script lang="ts">
  import { TIERS } from '#lib/collection';
  import Seo from '#lib/components/Seo.svelte';
  import { m } from '#lib/paraglide/messages';
  import Avatar from '#lib/components/Avatar.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import Podium from '#lib/components/Podium.svelte';
  import { formatNumber, tierLabel } from '#lib/labels';

  let { data } = $props();

  const others = $derived(data.ranking.slice(3));
</script>

<Seo title="{m.ranking()} — Project Achievers" description={m.ranking_rules()} />

<div class="mx-auto max-w-3xl space-y-6">
  <div class="space-y-1">
    <h1>{m.ranking()}</h1>
    <p class="text-sm text-muted">{m.ranking_rules()}</p>
    <a href="/clans" class="text-sm text-muted hover:text-ink">{m.clans_title()} →</a>
  </div>

  {#if data.ranking.length === 0}
    <Empty title={m.ranking_collectors_empty()} />
  {:else}
    <Podium collectors={data.ranking.slice(0, 3)} more={false} />
  {/if}

  {#if others.length}
    <ol class="card divide-y divide-line" start="4">
      {#each others as row, index (row.handle)}
        <li>
          <a
            href="/u/{row.handle}"
            aria-current={row.handle === data.user?.handle ? 'true' : undefined}
            class="flex items-center gap-3 p-3 transition-colors hover:bg-raised"
            class:bg-raised={row.handle === data.user?.handle}
          >
            <span class="tabular w-7 text-right text-xs text-muted">{index + 4}</span>
            <Avatar person={row} size={28} />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{row.displayName}</span>
            <span class="hidden gap-3 text-xs sm:flex">
              {#each TIERS as tier (tier)}
                {#if row.tiers[tier - 1]}
                  <span class="stat-value !text-xs" data-tier={tier} title={tierLabel(tier)}>
                    {row.tiers[tier - 1]}
                  </span>
                {/if}
              {/each}
            </span>
            <span class="tabular text-sm">{formatNumber(row.score)}</span>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</div>
