<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import AchievementIcon from '$lib/components/AchievementIcon.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import { formatRarity } from '$lib/labels';
  import { toast } from '$lib/stores/toast';

  let { data } = $props();

  const submit: SubmitFunction = () => {
    return async ({ result, update }) => {
      await update({ reset: false });
      if (result.type === 'failure') {
        toast(String(result.data?.error ?? m.action_failed()), 'error');
      }
    };
  };
</script>

<svelte:head><title>{m.showcase_edit()} — Project Achievers</title></svelte:head>

{#snippet details(achievement: (typeof data.pinned)[number] | (typeof data.results)[number])}
  <AchievementIcon src={achievement.iconUrl} size={40} />
  <div class="min-w-0 flex-1">
    <p class="truncate text-sm font-medium">{achievement.name}</p>
    <p class="truncate text-xs text-muted">
      {achievement.game.name}{#if achievement.globalRarity !== null}
        · {m.achievement_rarity({ value: formatRarity(achievement.globalRarity) })}{/if}
    </p>
  </div>
{/snippet}

<div class="mx-auto max-w-3xl space-y-6">
  <div class="space-y-1">
    <h1>{m.showcase_edit()}</h1>
    <p class="text-sm text-muted">{m.showcase_edit_help({ max: data.max })}</p>
  </div>

  <section class="space-y-3">
    <h2>{m.showcase_selected({ count: data.pinned.length, max: data.max })}</h2>
    {#if data.pinned.length}
      <ul class="card divide-y divide-line">
        {#each data.pinned as achievement, index (achievement.id)}
          <li class="flex items-center gap-3 p-3">
            {@render details(achievement)}
            <form method="POST" action="?/move" use:enhance={submit} class="flex">
              <input type="hidden" name="id" value={achievement.id} />
              <button
                name="direction"
                value="up"
                class="btn btn-ghost h-8 w-8 px-0"
                disabled={index === 0}
                aria-label={m.showcase_up()}
              >
                <ChevronUp size={16} aria-hidden="true" />
              </button>
              <button
                name="direction"
                value="down"
                class="btn btn-ghost h-8 w-8 px-0"
                disabled={index === data.pinned.length - 1}
                aria-label={m.showcase_down()}
              >
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </form>
            <form method="POST" action="?/remove" use:enhance={submit}>
              <input type="hidden" name="id" value={achievement.id} />
              <button class="btn btn-ghost h-8">{m.showcase_remove()}</button>
            </form>
          </li>
        {/each}
      </ul>
    {:else}
      <Empty title={m.showcase_none()} />
    {/if}
  </section>

  <section class="space-y-3">
    <h2>{m.showcase_my_achievements()}</h2>
    <form method="GET" class="flex gap-2">
      <input
        type="search"
        name="q"
        value={data.q}
        aria-label={m.showcase_search()}
        placeholder={m.showcase_search()}
        class="input"
      />
      <button class="btn">{m.search_short()}</button>
    </form>

    {#if data.results.length}
      <ul class="card divide-y divide-line">
        {#each data.results as achievement (achievement.id)}
          <li class="flex items-center gap-3 p-3">
            {@render details(achievement)}
            <form method="POST" action="?/add" use:enhance={submit}>
              <input type="hidden" name="id" value={achievement.id} />
              <button class="btn h-8" disabled={data.pinned.length >= data.max}>
                {m.showcase_add()}
              </button>
            </form>
          </li>
        {/each}
      </ul>
    {:else}
      <Empty title={m.showcase_no_results()} />
    {/if}
  </section>

  <a href="/compte" class="btn">{m.my_account()}</a>
</div>
