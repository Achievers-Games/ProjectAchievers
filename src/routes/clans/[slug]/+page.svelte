<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import Seo from '#lib/components/Seo.svelte';
  import { enhance } from '$app/forms';
  import Avatar from '#lib/components/Avatar.svelte';
  import Progress from '#lib/components/Progress.svelte';
  import SiteBadge from '#lib/components/SiteBadge.svelte';
  import StepDots from '#lib/components/StepDots.svelte';
  import { formatDate, formatNumber } from '#lib/labels';

  let { data } = $props();
  const clan = $derived(data.clan);
  const achievements = $derived(data.achievements);
</script>

<Seo
  title="{clan.name} — Project Achievers"
  description="{clan.name} : {m.count_achievements({ count: clan.achievements })}"
/>

<div class="mx-auto max-w-2xl space-y-6">
  <header class="space-y-1">
    <a href="/clans" class="text-sm text-muted hover:text-ink">{m.clans_title()}</a>
    <div class="flex items-center gap-3">
      <Avatar name={clan.name} src={clan.image} frame={clan.frame} size={56} play="always" />
      <h1>{clan.name}</h1>
    </div>
    <p class="text-sm text-muted">{m.clan_founded({ date: formatDate(clan.createdAt) })}</p>
    {#if data.moderator}
      <div class="flex flex-wrap gap-2">
        <form method="POST" action="?/flagName" use:enhance>
          <button class="btn btn-danger text-xs" title={m.clan_flag_help()}>
            {m.clan_flag()}
          </button>
        </form>
        {#if clan.image}
          <form method="POST" action="?/removeImage" use:enhance>
            <button class="btn btn-danger text-xs">{m.clan_image_remove_mod()}</button>
          </form>
        {/if}
      </div>
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
            {#if member.role === 'OWNER'}
              <span class="text-xs text-muted">{m.clan_role_owner()}</span>
            {:else if member.role === 'OFFICER'}
              <span class="text-xs text-muted">{m.clan_role_officer()}</span>
            {/if}
            <span class="tabular text-sm">{formatNumber(member.achievements)}</span>
          </a>
        </li>
      {/each}
    </ol>
  </section>

  <section class="space-y-2" data-testid="clan-achievements">
    <h2>
      {m.clan_ach_title()}
      <span class="tabular text-sm text-muted">
        {achievements.earned}/{achievements.total}
      </span>
    </h2>
    <p class="text-sm text-muted">{m.clan_ach_note()}</p>
    <ul class="grid gap-2 sm:grid-cols-2">
      {#each achievements.items as item (item.code)}
        <li class="card flex gap-3 p-3" class:opacity-70={!item.unlockedAt}>
          <SiteBadge
            icon={achievements.icons[item.icon] ?? ''}
            category={item.secret ? 'secret' : 'clan'}
            level={item.level}
            unlocked={item.unlockedAt !== null}
          />
          <div class="min-w-0 flex-1">
            <p class="font-medium">{item.title}</p>
            <p class="text-sm text-muted">{item.text}</p>
            {#if item.steps.length}
              <StepDots steps={item.steps} />
            {/if}
            {#if item.progress}
              <div class="mt-1.5">
                <Progress value={item.progress.value} max={item.progress.goal} label={item.title} />
              </div>
              <p class="tabular mt-0.5 text-xs text-muted">
                {formatNumber(Math.min(item.progress.value, item.progress.goal))} / {formatNumber(
                  item.progress.goal,
                )}
              </p>
            {:else if item.unlockedAt}
              <p class="mt-1 text-xs text-muted">{formatDate(item.unlockedAt)}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>
</div>
