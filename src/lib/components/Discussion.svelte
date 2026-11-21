<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Avatar from './Avatar.svelte';
  import TranslateButton from './TranslateButton.svelte';
  import { formatRelative } from '#lib/labels';
  import { postAction, reportContent, submitWithToast } from '#lib/forms';
  import { Translations } from '#lib/translations.svelte';
  import { page } from '$app/state';
  import { COMMENTS_PARAM, COMMENTS_STEP, commentLimit } from '#lib/comments';
  import type { CommentView } from '#lib/server/comments';

  /**
   * La discussion d'une page, sous un succès ou sous un guide complet. La page fournit les
   * actions `comment`, `react`, `deleteComment`, `translateComment` et `reportComment`
   * (voir `commentActions`).
   */
  let {
    comments,
    signedIn,
    signInHref,
    canTranslate,
    actionQuery = '',
  }: {
    comments: CommentView[];
    signedIn: boolean;
    signInHref: string;
    canTranslate: boolean;
    actionQuery?: string;
  } = $props();

  type Item = CommentView | CommentView['replies'][number];

  // Le serveur envoie un commentaire de plus que demandé quand il en reste.
  const limit = $derived(commentLimit(page.url));
  const shown = $derived(comments.slice(0, limit));
  const moreHref = $derived.by(() => {
    if (comments.length <= limit) return null;
    const next = new URL(page.url.href);
    next.searchParams.set(COMMENTS_PARAM, String(limit + COMMENTS_STEP));
    return `${next.pathname}${next.search}`;
  });

  const REACTIONS = [
    { type: 'HELPFUL', label: m.reaction_helpful(), emoji: '👍' },
    { type: 'THANKS', label: m.reaction_thanks(), emoji: '🙏' },
    { type: 'FUNNY', label: m.reaction_funny(), emoji: '😂' },
  ] as const;

  let replyTo = $state<string | null>(null);
  const actionHref = (action: string) => `?/${action}${actionQuery ? `&${actionQuery}` : ''}`;
  const translations = new Translations<Item>((item) =>
    postAction('translateComment', { id: item.id }, actionQuery),
  );

  const submit = submitWithToast({
    onSuccess: (form) => {
      if (form.dataset.closes) replyTo = null;
    },
  });

  $effect(() => translations.auto(comments.flatMap((comment) => [comment, ...comment.replies])));
</script>

<section class="space-y-3">
  <h2>{m.discussion()}</h2>

  {#snippet commentView(comment: Item, isReply: boolean)}
    <article class="flex gap-3">
      <Avatar person={comment.author} size={28} />
      <div class="min-w-0 flex-1 space-y-1">
        <p class="text-xs text-muted">
          <a href="/u/{comment.author.handle}" class="font-medium text-ink">
            {comment.author.displayName}
          </a>
          · {formatRelative(comment.createdAt)}
        </p>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- assaini par renderMarkdown -->
        <div class="prose-user">{@html translations.html(comment)}</div>
        <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
          {#if !comment.mine && canTranslate}
            <TranslateButton {translations} item={comment} />
          {/if}
          {#if signedIn}
            <form
              method="POST"
              action={actionHref('react')}
              use:enhance={submit}
              class="flex gap-2"
            >
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
              <button type="button" class="hover:text-ink" onclick={() => (replyTo = comment.id)}>
                {m.reply()}
              </button>
            {/if}
            {#if comment.mine}
              <form method="POST" action={actionHref('deleteComment')} use:enhance={submit}>
                <input type="hidden" name="id" value={comment.id} />
                <button class="hover:text-danger">{m.delete()}</button>
              </form>
            {:else}
              <button
                type="button"
                class="hover:text-ink"
                onclick={() => reportContent('reportComment', { id: comment.id }, actionQuery)}
              >
                {m.report()}
              </button>
            {/if}
          {/if}
        </div>
      </div>
    </article>
  {/snippet}

  {#snippet commentForm(parentId: string | null)}
    <form
      method="POST"
      action={actionHref('comment')}
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
        aria-label={parentId ? m.reply_label() : m.comment_label()}
        placeholder={parentId ? m.reply_placeholder() : m.comment_placeholder()}
        class="input h-auto py-2"></textarea>
      <button class="btn">{m.publish()}</button>
    </form>
  {/snippet}

  <div class="space-y-5">
    {#each shown as comment (comment.id)}
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
      <p class="text-sm text-muted">{m.comments_empty()}</p>
    {/each}
    {#if moreHref}
      <a href={moreHref} class="btn btn-ghost" data-sveltekit-noscroll data-sveltekit-replacestate>
        {m.show_more()}
      </a>
    {/if}
  </div>

  {#if signedIn}
    {@render commentForm(null)}
  {:else}
    <a href={signInHref} class="btn" rel="nofollow">{m.sign_in_to_join()}</a>
  {/if}
</section>
