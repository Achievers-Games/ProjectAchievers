<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { deserialize, enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Flag from '@lucide/svelte/icons/flag';
  import AchievementIcon from '$lib/components/AchievementIcon.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import TrophyBadge from '$lib/components/TrophyBadge.svelte';
  import { formatDate, formatRarity, formatRelative } from '$lib/labels';
  import { toast } from '$lib/stores/toast';

  let { data } = $props();

  let writingGuide = $state(false);
  let replyTo = $state<string | null>(null);
  let translations = $state<Record<string, { html: string; shown: boolean }>>({});
  let translating = $state<string | null>(null);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ne doit pas relancer l'effet
  const attempted = new Set<string>();

  type Target = 'GUIDE' | 'COMMENT';
  const MAX_AUTO_TRANSLATIONS = 10;

  const REACTIONS = [
    { type: 'HELPFUL', label: m.reaction_helpful(), emoji: '👍' },
    { type: 'THANKS', label: m.reaction_thanks(), emoji: '🙏' },
    { type: 'FUNNY', label: m.reaction_funny(), emoji: '😂' },
  ] as const;

  /** Applique la réponse sans recharger la page et remonte le résultat en toast. */
  const submit: SubmitFunction = ({ formElement }) => {
    return async ({ result, update }) => {
      await update({ reset: result.type === 'success', invalidateAll: true });
      if (result.type === 'failure')
        toast(String(result.data?.error ?? m.action_failed()), 'error');
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

  interface Translatable {
    id: string;
    html: string;
    translatedHtml: string | null;
    autoTranslate: boolean;
  }

  const translationOf = (item: Translatable) =>
    translations[item.id] ??
    (item.translatedHtml ? { html: item.translatedHtml, shown: true } : undefined);

  const shownHtml = (item: Translatable) => {
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

  async function fetchTranslation(targetType: Target, item: Translatable): Promise<string> {
    translating = item.id;
    try {
      const result = await postAction('translate', { targetType, targetId: item.id });
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
  async function translate(targetType: Target, item: Translatable) {
    const known = translationOf(item);
    if (known) {
      translations[item.id] = { html: known.html, shown: !known.shown };
      return;
    }
    const failure = await fetchTranslation(targetType, item);
    if (failure) toast(failure, 'error');
  }

  /** Une par une, et discrètement : un quota épuisé laisse simplement les textes d'origine. */
  async function translatePage(pending: [Target, Translatable][]) {
    for (const [type, item] of pending.slice(0, MAX_AUTO_TRANSLATIONS)) {
      attempted.add(item.id);
      if (await fetchTranslation(type, item)) return;
    }
  }

  $effect(() => {
    const replies = data.comments.flatMap((comment) => comment.replies);
    const pending = [
      ...data.guides.map((guide): [Target, Translatable] => ['GUIDE', guide]),
      ...[...data.comments, ...replies].map((item): [Target, Translatable] => ['COMMENT', item]),
    ].filter(([, item]) => item.autoTranslate && !item.translatedHtml && !attempted.has(item.id));
    void translatePage(pending);
  });

  async function report(type: 'GUIDE' | 'COMMENT', id: string) {
    const reason = prompt(m.report_prompt());
    if (!reason) return;
    const result = await postAction('report', { targetType: type, targetId: id, reason });
    if (result.type === 'success') toast(m.report_sent());
    else {
      const message = result.type === 'failure' ? result.data?.error : null;
      toast(String(message ?? m.report_failed()), 'error');
    }
  }
</script>

<svelte:head>
  <title>{data.achievement.name} — {data.achievement.game.name}</title>
  <meta name="description" content={data.achievement.description} />
</svelte:head>

{#snippet translateButton(type: Target, item: Translatable)}
  {#if data.canTranslate}
    <button
      type="button"
      class="text-xs text-muted hover:text-ink"
      disabled={translating === item.id}
      onclick={() => translate(type, item)}
    >
      {#if translating === item.id}
        {m.translating()}
      {:else if translationOf(item)?.shown}
        {m.translate_original()}
      {:else}
        {m.translate()}
      {/if}
    </button>
  {/if}
{/snippet}

<div class="mx-auto max-w-3xl space-y-8">
  <header class="flex gap-4">
    {#if data.achievement.iconUrl}
      <AchievementIcon src={data.achievement.iconUrl} size={64} />
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
          <span>{m.achievement_rarity({ value: formatRarity(data.achievement.globalRarity) })}</span
          >
        {/if}
        <span>{m.count_points({ count: data.achievement.points })}</span>
        {#if data.unlockedAt}
          <span class="text-success"
            >{m.achievement_unlocked_on({ date: formatDate(data.unlockedAt) })}</span
          >
        {/if}
      </p>
    </div>
  </header>

  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <h2>{m.guides()}</h2>
      {#if data.user}
        <button type="button" class="btn" onclick={() => (writingGuide = !writingGuide)}>
          {writingGuide ? m.cancel() : m.guide_write()}
        </button>
      {/if}
    </div>

    {#if writingGuide}
      <form method="POST" action="?/guide" use:enhance={submit} data-closes="1" class="space-y-2">
        <label class="label" for="guide-content">{m.guide_label()}</label>
        <textarea
          id="guide-content"
          name="content"
          rows="8"
          required
          minlength="3"
          class="input h-auto py-2"
        ></textarea>
        <button class="btn btn-primary">{m.publish()}</button>
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
            aria-label={m.vote_up()}
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
            aria-label={m.vote_down()}
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
          <div class="prose-user">{@html shownHtml(guide)}</div>
          <div class="flex gap-3">
            {#if !guide.mine}{@render translateButton('GUIDE', guide)}{/if}
            {#if guide.mine}
              <form method="POST" action="?/deleteGuide" use:enhance={submit}>
                <input type="hidden" name="id" value={guide.id} />
                <button class="text-xs text-muted hover:text-danger">{m.delete()}</button>
              </form>
            {:else if data.user}
              <button
                type="button"
                class="flex items-center gap-1 text-xs text-muted hover:text-ink"
                onclick={() => report('GUIDE', guide.id)}
              >
                <Flag size={12} aria-hidden="true" />
                {m.report()}
              </button>
            {/if}
          </div>
        </div>
      </article>
    {:else}
      <Empty title={m.guides_empty()}>
        {data.user ? m.guides_empty_user() : m.guides_empty_visitor()}
      </Empty>
    {/each}
  </section>

  <section class="space-y-3">
    <h2>{m.discussion()}</h2>

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
            <p class="text-sm italic text-muted">{m.comment_deleted()}</p>
          {:else}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- assaini par renderMarkdown -->
            <div class="prose-user">{@html shownHtml(comment)}</div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
              {#if !comment.mine}{@render translateButton('COMMENT', comment)}{/if}
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
                    {m.reply()}
                  </button>
                {/if}
                {#if comment.mine}
                  <form method="POST" action="?/deleteComment" use:enhance={submit}>
                    <input type="hidden" name="id" value={comment.id} />
                    <button class="hover:text-danger">{m.delete()}</button>
                  </form>
                {:else}
                  <button
                    type="button"
                    class="hover:text-ink"
                    onclick={() => report('COMMENT', comment.id)}
                  >
                    {m.report()}
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
          aria-label={parentId ? m.reply_label() : m.comment_label()}
          placeholder={parentId ? m.reply_placeholder() : m.comment_placeholder()}
          class="input h-auto py-2"
        ></textarea>
        <button class="btn">{m.publish()}</button>
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
        <p class="text-sm text-muted">{m.comments_empty()}</p>
      {/each}
    </div>

    {#if data.user}
      {@render commentForm(null)}
    {:else}
      <a href="/connexion?retour=/succes/{data.achievement.id}" class="btn">
        {m.sign_in_to_join()}
      </a>
    {/if}
  </section>
</div>
