<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { deserialize, enhance } from '$app/forms';
  import Avatar from './Avatar.svelte';
  import { formatRelative } from '#lib/labels';
  import { submitWithToast } from '#lib/forms';
  import { toast } from '#lib/stores/toast';
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
  }: {
    comments: CommentView[];
    signedIn: boolean;
    signInHref: string;
    canTranslate: boolean;
  } = $props();

  type Item = CommentView | CommentView['replies'][number];

  const MAX_AUTO_TRANSLATIONS = 10;
  const REACTIONS = [
    { type: 'HELPFUL', label: m.reaction_helpful(), emoji: '👍' },
    { type: 'THANKS', label: m.reaction_thanks(), emoji: '🙏' },
    { type: 'FUNNY', label: m.reaction_funny(), emoji: '😂' },
  ] as const;

  let replyTo = $state<string | null>(null);
  let translations = $state<Record<string, { html: string; shown: boolean }>>({});
  let translating = $state<string | null>(null);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ne doit pas relancer l'effet
  const attempted = new Set<string>();

  const submit = submitWithToast({
    onSuccess: (form) => {
      if (form.dataset.closes) replyTo = null;
    },
  });

  const translationOf = (item: Item) =>
    translations[item.id] ??
    (item.translatedHtml ? { html: item.translatedHtml, shown: true } : undefined);

  const shownHtml = (item: Item) => {
    const translation = translationOf(item);
    return translation?.shown ? translation.html : item.html;
  };

  async function postAction(action: string, fields: Record<string, string>) {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    const response = await fetch(`?/${action}`, {
      method: 'POST',
      body,
      headers: { 'x-sveltekit-action': 'true' },
    });
    return deserialize(await response.text());
  }

  async function fetchTranslation(item: Item): Promise<string> {
    translating = item.id;
    try {
      const result = await postAction('translateComment', { id: item.id });
      if (result.type === 'success') {
        translations[item.id] = { html: String(result.data?.html), shown: true };
        return '';
      }
      return String((result.type === 'failure' && result.data?.error) || m.translate_failed());
    } catch {
      return m.translate_failed();
    } finally {
      translating = null;
    }
  }

  /** La traduction reste en mémoire : revenir à l'original puis à la traduction est immédiat. */
  async function translate(item: Item) {
    const known = translationOf(item);
    if (known) {
      translations[item.id] = { html: known.html, shown: !known.shown };
      return;
    }
    const failure = await fetchTranslation(item);
    if (failure) toast(failure, 'error');
  }

  /** Une par une, et discrètement : un quota épuisé laisse simplement les textes d'origine. */
  $effect(() => {
    let cancelled = false;
    const pending = comments
      .flatMap((comment) => [comment, ...comment.replies])
      .filter((item) => item.autoTranslate && !item.translatedHtml && !attempted.has(item.id))
      .slice(0, MAX_AUTO_TRANSLATIONS);
    void (async () => {
      for (const item of pending) {
        attempted.add(item.id);
        if (cancelled) return;
        if (await fetchTranslation(item)) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  async function report(id: string) {
    const reason = prompt(m.report_prompt());
    if (!reason) return;
    const result = await postAction('reportComment', { id, reason });
    if (result.type === 'success') toast(m.report_sent());
    else {
      const message = result.type === 'failure' ? result.data?.error : null;
      toast(String(message ?? m.report_failed()), 'error');
    }
  }
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
        <div class="prose-user">{@html shownHtml(comment)}</div>
        <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
          {#if !comment.mine && canTranslate}
            <button
              type="button"
              class="text-xs text-muted hover:text-ink"
              disabled={translating === comment.id}
              onclick={() => translate(comment)}
            >
              {#if translating === comment.id}
                {m.translating()}
              {:else if translationOf(comment)?.shown}
                {m.translate_original()}
              {:else}
                {m.translate()}
              {/if}
            </button>
          {/if}
          {#if signedIn}
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
              <button type="button" class="hover:text-ink" onclick={() => (replyTo = comment.id)}>
                {m.reply()}
              </button>
            {/if}
            {#if comment.mine}
              <form method="POST" action="?/deleteComment" use:enhance={submit}>
                <input type="hidden" name="id" value={comment.id} />
                <button class="hover:text-danger">{m.delete()}</button>
              </form>
            {:else}
              <button type="button" class="hover:text-ink" onclick={() => report(comment.id)}>
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
        aria-label={parentId ? m.reply_label() : m.comment_label()}
        placeholder={parentId ? m.reply_placeholder() : m.comment_placeholder()}
        class="input h-auto py-2"></textarea>
      <button class="btn">{m.publish()}</button>
    </form>
  {/snippet}

  <div class="space-y-5">
    {#each comments as comment (comment.id)}
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
  </div>

  {#if signedIn}
    {@render commentForm(null)}
  {:else}
    <a href={signInHref} class="btn">{m.sign_in_to_join()}</a>
  {/if}
</section>
