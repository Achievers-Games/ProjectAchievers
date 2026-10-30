<script lang="ts">
  import { enhance } from '$app/forms';
  import Empty from '$lib/components/Empty.svelte';
  import { formatRelative } from '$lib/labels';

  let { data } = $props();
</script>

<svelte:head>
  <title>Modération — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
  <h1>Modération</h1>

  {#each data.reports as report (report.id)}
    <article class="card space-y-2 p-4">
      <p class="text-xs text-muted">
        {report.targetType === 'GUIDE' ? 'Guide' : 'Commentaire'} signalé par {report.reporter}
        · {formatRelative(report.createdAt)}
      </p>
      <p class="text-sm font-medium">{report.reason}</p>
      {#if report.target}
        <blockquote
          class="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-raised p-3 text-sm"
        >
          {report.target.contentMd || 'Contenu déjà supprimé.'}
        </blockquote>
        <a class="text-xs text-muted underline" href="/succes/{report.target.achievementId}">
          Voir le contexte
        </a>
      {/if}
      <form method="POST" action="?/resolve" use:enhance class="flex gap-2">
        <input type="hidden" name="id" value={report.id} />
        <button name="hide" value="1" class="btn btn-danger">Masquer le contenu</button>
        <button class="btn">Rejeter</button>
      </form>
    </article>
  {:else}
    <Empty title="Aucun signalement en attente" />
  {/each}
</div>
