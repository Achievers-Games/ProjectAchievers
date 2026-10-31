<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Empty from '$lib/components/Empty.svelte';
  import { formatRelative, PLATFORM_LABELS } from '$lib/labels';

  let { data } = $props();
</script>

<svelte:head>
  <title>{m.moderation()} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
  <h1>{m.moderation()}</h1>

  {#each data.reports as report (report.id)}
    <article class="card space-y-2 p-4">
      <p class="text-xs text-muted">
        {report.targetType === 'GUIDE'
          ? m.mod_reported_guide({ user: report.reporter })
          : m.mod_reported_comment({ user: report.reporter })}
        · {formatRelative(report.createdAt)}
      </p>
      <p class="text-sm font-medium">{report.reason}</p>
      {#if report.target}
        <blockquote
          class="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-raised p-3 text-sm"
        >
          {report.target.contentMd || m.mod_content_deleted()}
        </blockquote>
        <a class="text-xs text-muted underline" href="/succes/{report.target.achievementId}">
          {m.mod_context()}
        </a>
      {/if}
      <form method="POST" action="?/resolve" use:enhance class="flex gap-2">
        <input type="hidden" name="id" value={report.id} />
        <button name="hide" value="1" class="btn btn-danger">{m.mod_hide()}</button>
        <button class="btn">{m.mod_reject()}</button>
      </form>
    </article>
  {:else}
    <Empty title={m.mod_empty()} />
  {/each}

  <section class="space-y-3 pt-4">
    <h2>{m.mod_groups()}</h2>
    <p class="text-sm text-muted">
      {m.mod_groups_text()}
    </p>

    <form method="POST" action="?/join" use:enhance class="card flex flex-wrap gap-2 p-3">
      <input
        name="first"
        required
        aria-label={m.mod_first()}
        placeholder={m.mod_first_placeholder()}
        class="input max-w-xs"
      />
      <input
        name="second"
        required
        aria-label={m.mod_second()}
        placeholder={m.mod_second_placeholder()}
        class="input max-w-xs"
      />
      <button class="btn">{m.mod_join()}</button>
    </form>

    <ul class="card divide-y divide-line">
      {#each data.families as family (family.key)}
        <li class="space-y-1 p-3">
          {#each family.games as game (game.id)}
            <div class="flex items-center justify-between gap-2 text-sm">
              <a href="/jeux/{game.slug}" class="min-w-0 truncate">
                {game.name} · {PLATFORM_LABELS[game.platform]}
              </a>
              <form method="POST" action="?/separate" use:enhance>
                <input type="hidden" name="id" value={game.id} />
                <button class="btn btn-ghost h-7">{m.mod_separate()}</button>
              </form>
            </div>
          {/each}
        </li>
      {/each}
    </ul>
  </section>
</div>
