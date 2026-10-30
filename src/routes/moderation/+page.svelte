<script lang="ts">
  import { enhance } from '$app/forms';
  import Empty from '$lib/components/Empty.svelte';
  import { formatRelative, PLATFORM_LABELS } from '$lib/labels';

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

  <section class="space-y-3 pt-4">
    <h2>Jeux regroupés</h2>
    <p class="text-sm text-muted">
      Les versions d'un jeu sont réunies par leur titre. Sépare deux jeux différents qui portent le
      même nom, ou regroupe deux versions dont les titres diffèrent.
    </p>

    <form method="POST" action="?/join" use:enhance class="card flex flex-wrap gap-2 p-3">
      <input
        name="first"
        required
        aria-label="Premier jeu"
        placeholder="Adresse du jeu"
        class="input max-w-xs"
      />
      <input
        name="second"
        required
        aria-label="Second jeu"
        placeholder="Adresse de l'autre version"
        class="input max-w-xs"
      />
      <button class="btn">Regrouper</button>
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
                <button class="btn btn-ghost h-7">Séparer</button>
              </form>
            </div>
          {/each}
        </li>
      {/each}
    </ul>
  </section>
</div>
