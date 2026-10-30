<script lang="ts">
  import { deserialize, enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { ChevronDown, ChevronUp, Flag } from '@lucide/svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import TrophyBadge from '$lib/components/TrophyBadge.svelte';
  import { formatDate, formatRelative, plural } from '$lib/labels';
  import { toast } from '$lib/stores/toast';

  let { data } = $props();

  let writingGuide = $state(false);
  let replyTo = $state<string | null>(null);

  const REACTIONS = [
    { type: 'HELPFUL', label: 'Utile', emoji: '👍' },
    { type: 'THANKS', label: 'Merci', emoji: '🙏' },
    { type: 'FUNNY', label: 'Drôle', emoji: '😂' },
  ] as const;

  /** Applique la réponse sans recharger la page et remonte le résultat en toast. */
  const submit: SubmitFunction = ({ formElement }) => {
    return async ({ result, update }) => {
      await update({ reset: result.type === 'success', invalidateAll: true });
      if (result.type === 'failure')
        toast(String(result.data?.error ?? 'Action impossible.'), 'error');
      else if (result.type === 'success') {
        if (result.data?.success) toast(String(result.data.success));
        if (formElement.dataset.closes) {
          writingGuide = false;
          replyTo = null;
        }
      }
    };
  };

  /** Vote optimiste : le score bouge tout de suite, le serveur tranche ensuite. */
  const vote: SubmitFunction = ({ formData }) => {
    const guide = data.guides.find((g) => g.id === formData.get('guideId'));
    const value = Number(formData.get('value'));
    if (guide) {
      const next = guide.myVote === value ? 0 : value;
      guide.score += next - guide.myVote;
      guide.myVote = next;
    }
    return async ({ result }) => {
      if (result.type === 'redirect') location.assign(result.location);
      else await invalidateAll();
    };
  };

  async function report(type: 'GUIDE' | 'COMMENT', id: string) {
    const reason = prompt('Pourquoi signaler ce contenu ?');
    if (!reason) return;
    const body = new FormData();
    body.set('targetType', type);
    body.set('targetId', id);
    body.set('reason', reason);
    const response = await fetch('?/report', {
      method: 'POST',
      body,
      headers: { 'x-sveltekit-action': 'true' },
    });
    const result = deserialize(await response.text());
    if (result.type === 'success') toast('Signalement envoyé. Merci.');
    else {
      const message = result.type === 'failure' ? result.data?.error : null;
      toast(String(message ?? 'Le signalement a échoué.'), 'error');
    }
  }
</script>

<svelte:head>
  <title>{data.achievement.name} — {data.achievement.game.name}</title>
  <meta name="description" content={data.achievement.description} />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-8">
  <header class="flex gap-4">
    {#if data.achievement.iconUrl}
      <img src={data.achievement.iconUrl} alt="" width="64" height="64" class="rounded" />
    {/if}
    <div class="min-w-0 space-y-1">
      <a href="/jeux/{data.achievement.game.slug}" class="text-sm text-muted hover:text-ink">
        {data.achievement.game.name}
      </a>
      <h1>{data.achievement.name}</h1>
      <p class="text-sm text-muted">{data.achievement.description}</p>
      <p class="tabular flex flex-wrap items-center gap-x-3 text-xs text-muted">
        <TrophyBadge type={data.achievement.trophyType} />
        {#if data.achievement.globalRarity !== null}
          <span>{data.achievement.globalRarity.toFixed(1)} % des joueurs</span>
        {/if}
        <span>{plural(data.achievement.points, 'point')}</span>
        {#if data.unlockedAt}
          <span class="text-success">Obtenu le {formatDate(data.unlockedAt)}</span>
        {/if}
      </p>
    </div>
  </header>

  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <h2>Guides</h2>
      {#if data.user}
        <button type="button" class="btn" onclick={() => (writingGuide = !writingGuide)}>
          {writingGuide ? 'Annuler' : 'Écrire un guide'}
        </button>
      {/if}
    </div>

    {#if writingGuide}
      <form method="POST" action="?/guide" use:enhance={submit} data-closes="1" class="space-y-2">
        <label class="label" for="guide-content">Ton guide (Markdown accepté)</label>
        <textarea
          id="guide-content"
          name="content"
          rows="8"
          required
          minlength="3"
          class="input h-auto py-2"
        ></textarea>
        <button class="btn btn-primary">Publier</button>
      </form>
    {/if}

    {#each data.guides as guide (guide.id)}
      <article class="card flex gap-3 p-4">
        <form method="POST" action="?/vote" use:enhance={vote} class="flex flex-col items-center">
          <input type="hidden" name="guideId" value={guide.id} />
          <button
            name="value"
            value="1"
            class="btn-ghost rounded p-1"
            class:text-accent={guide.myVote === 1}
            aria-label="Voter pour ce guide"
            aria-pressed={guide.myVote === 1}
          >
            <ChevronUp size={18} />
          </button>
          <span class="tabular text-sm font-medium">{guide.score}</span>
          <button
            name="value"
            value="-1"
            class="btn-ghost rounded p-1"
            class:text-danger={guide.myVote === -1}
            aria-label="Voter contre ce guide"
            aria-pressed={guide.myVote === -1}
          >
            <ChevronDown size={18} />
          </button>
        </form>
        <div class="min-w-0 flex-1 space-y-2">
          <p class="flex items-center gap-2 text-xs text-muted">
            <a href="/u/{guide.author.handle}" class="font-medium text-ink">
              {guide.author.displayName}
            </a>
            {formatRelative(guide.createdAt)}
          </p>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- assaini par renderMarkdown -->
          <div class="prose-user">{@html guide.html}</div>
          <div class="flex gap-2">
            {#if guide.mine}
              <form method="POST" action="?/deleteGuide" use:enhance={submit}>
                <input type="hidden" name="id" value={guide.id} />
                <button class="text-xs text-muted hover:text-danger">Supprimer</button>
              </form>
            {:else if data.user}
              <button
                type="button"
                class="flex items-center gap-1 text-xs text-muted hover:text-ink"
                onclick={() => report('GUIDE', guide.id)}
              >
                <Flag size={12} aria-hidden="true" /> Signaler
              </button>
            {/if}
          </div>
        </div>
      </article>
    {:else}
      <Empty title="Pas encore de guide">
        {data.user
          ? 'Sois le premier à partager ta méthode.'
          : 'Connecte-toi pour écrire le premier.'}
      </Empty>
    {/each}
  </section>

  <section class="space-y-3">
    <h2>Discussion</h2>

    {#snippet commentView(
      comment: (typeof data.comments)[number] | (typeof data.comments)[number]['replies'][number],
      isReply: boolean,
    )}
      <article class="flex gap-3">
        <Avatar name={comment.author.displayName} src={comment.author.avatarUrl} size={28} />
        <div class="min-w-0 flex-1 space-y-1">
          <p class="text-xs text-muted">
            <a href="/u/{comment.author.handle}" class="font-medium text-ink">
              {comment.author.displayName}
            </a>
            · {formatRelative(comment.createdAt)}
          </p>
          {#if comment.deleted}
            <p class="text-sm italic text-muted">Commentaire supprimé.</p>
          {:else}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- assaini par renderMarkdown -->
            <div class="prose-user">{@html comment.html}</div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
              {#if data.user}
                <form method="POST" action="?/react" use:enhance={submit} class="flex gap-2">
                  <input type="hidden" name="commentId" value={comment.id} />
                  {#each REACTIONS as reaction (reaction.type)}
                    <button
                      name="type"
                      value={reaction.type}
                      aria-label={reaction.label}
                      title={reaction.label}
                      aria-pressed={comment.myReaction === reaction.type}
                      class="reaction"
                      class:reaction-active={comment.myReaction === reaction.type}
                    >
                      {reaction.emoji}{#if comment.counts[reaction.type]}
                        &nbsp;{comment.counts[reaction.type]}{/if}
                    </button>
                  {/each}
                </form>
                {#if !isReply}
                  <button
                    type="button"
                    class="hover:text-ink"
                    onclick={() => (replyTo = comment.id)}
                  >
                    Répondre
                  </button>
                {/if}
                {#if comment.mine}
                  <form method="POST" action="?/deleteComment" use:enhance={submit}>
                    <input type="hidden" name="id" value={comment.id} />
                    <button class="hover:text-danger">Supprimer</button>
                  </form>
                {:else}
                  <button
                    type="button"
                    class="hover:text-ink"
                    onclick={() => report('COMMENT', comment.id)}
                  >
                    Signaler
                  </button>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      </article>
    {/snippet}

    {#snippet commentForm(parentId: string | null)}
      <form
        method="POST"
        action="?/comment"
        use:enhance={submit}
        data-closes={parentId ? '1' : undefined}
        class="space-y-2"
      >
        {#if parentId}<input type="hidden" name="parentId" value={parentId} />{/if}
        <textarea
          name="content"
          rows="2"
          required
          minlength="3"
          aria-label={parentId ? 'Ta réponse' : 'Ton commentaire'}
          placeholder={parentId ? 'Ta réponse…' : 'Ajouter un commentaire…'}
          class="input h-auto py-2"
        ></textarea>
        <button class="btn">Publier</button>
      </form>
    {/snippet}

    <div class="space-y-5">
      {#each data.comments as comment (comment.id)}
        <div class="space-y-3">
          {@render commentView(comment, false)}
          {#if comment.replies.length || replyTo === comment.id}
            <div class="ml-10 space-y-3 border-l border-line pl-4">
              {#each comment.replies as reply (reply.id)}
                {@render commentView(reply, true)}
              {/each}
              {#if replyTo === comment.id}{@render commentForm(comment.id)}{/if}
            </div>
          {/if}
        </div>
      {:else}
        <p class="text-sm text-muted">Aucun commentaire pour le moment.</p>
      {/each}
    </div>

    {#if data.user}
      {@render commentForm(null)}
    {:else}
      <a href="/connexion?retour=/succes/{data.achievement.id}" class="btn">
        Connecte-toi pour participer
      </a>
    {/if}
  </section>
</div>
