<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { deserialize, enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '$app/forms';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Flag from '@lucide/svelte/icons/flag';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import AchievementIcon from '#lib/components/AchievementIcon.svelte';
  import Discussion from '#lib/components/Discussion.svelte';
  import Empty from '#lib/components/Empty.svelte';
  import TrophyBadge from '#lib/components/TrophyBadge.svelte';
  import { formatDate, formatRarity, formatRelative } from '#lib/labels';
  import { guideChecks } from '#lib/actions/guide-checks';
  import { submitWithToast } from '#lib/forms';
  import { toast } from '#lib/stores/toast';

  let { data } = $props();

  type Guide = (typeof data.guides)[number];

  let writingGuide = $state(false);
  let showBuried = $state(false);
  const shownGuides = $derived(data.guides.filter((guide) => !guide.buried));
  const buriedGuides = $derived(data.guides.filter((guide) => guide.buried));
  let translations = $state<Record<string, { html: string; shown: boolean }>>({});
  let translating = $state<string | null>(null);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ne doit pas relancer l'effet
  const attempted = new Set<string>();

  type Target = 'GUIDE' | 'COMMENT';
  const MAX_AUTO_TRANSLATIONS = 10;

  /** Applique la réponse sans recharger la page et remonte le résultat en toast. */
  const submit = submitWithToast({
    onSuccess: (form) => {
      if (form.dataset.closes) writingGuide = false;
    },
  });

  /** Le vote optimiste vit ici : `data` appartient à la route et serait écrasé au moindre rechargement. */
  let votes = $state<Record<string, { score: number; myVote: number }>>({});
  const scoreOf = (guide: { id: string; score: number }) => votes[guide.id]?.score ?? guide.score;
  const voteOf = (guide: { id: string; myVote: number }) => votes[guide.id]?.myVote ?? guide.myVote;

  /** Vote optimiste : le score bouge tout de suite, le serveur tranche ensuite. */
  const vote: SubmitFunction = ({ formData }) => {
    const guide = data.guides.find((g) => g.id === formData.get('guideId'));
    const value = Number(formData.get('value'));
    if (guide) {
      const current = voteOf(guide);
      const next = current === value ? 0 : value;
      votes = { ...votes, [guide.id]: { score: scoreOf(guide) + next - current, myVote: next } };
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
  async function translatePage(pending: [Target, Translatable][], cancelled: () => boolean) {
    for (const [type, item] of pending.slice(0, MAX_AUTO_TRANSLATIONS)) {
      attempted.add(item.id);
      if (cancelled()) return;
      if (await fetchTranslation(type, item)) return;
    }
  }

  $effect(() => {
    let cancelled = false;
    // Les commentaires se traduisent dans leur composant : ici, seulement les guides.
    const pending = data.guides
      .map((guide): [Target, Translatable] => ['GUIDE', guide])
      .filter(([, item]) => item.autoTranslate && !item.translatedHtml && !attempted.has(item.id));
    void translatePage(pending, () => cancelled);
    return () => {
      cancelled = true;
    };
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
        {#if data.unlockedAt}
          <span class="text-success"
            >{m.achievement_unlocked_on({ date: formatDate(data.unlockedAt) })}</span
          >
        {/if}
      </p>
      {#if data.secret}
        <a
          href={data.revealed ? '?' : '?caches=1'}
          rel="nofollow"
          data-sveltekit-reset="false"
          class="btn mt-2 h-8"
        >
          {#if data.revealed}
            <EyeOff size={14} aria-hidden="true" /> {m.achievement_conceal()}
          {:else}
            <Eye size={14} aria-hidden="true" /> {m.achievement_reveal()}
          {/if}
        </a>
      {/if}
    </div>
  </header>

  {#if data.achievement.missable}
    <div class="card missables-alert flex items-start gap-3 p-3 text-sm" role="note">
      <TriangleAlert size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <div class="space-y-1">
        <p class="font-medium">{m.missable_title()}</p>
        <p class="text-muted">
          {data.unlockedAt
            ? m.missable_done()
            : data.secret && !data.revealed
              ? m.missable_secret()
              : m.missable_text()}
        </p>
      </div>
    </div>
  {/if}

  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <h2>{m.guides()}</h2>
      {#if data.canWriteGuide}
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
          class="input h-auto py-2"></textarea>
        <button class="btn btn-primary">{m.publish()}</button>
      </form>
    {/if}

    {#snippet guideCard(guide: Guide)}
      <article class="card flex gap-3 p-4">
        <form method="POST" action="?/vote" use:enhance={vote} class="flex flex-col items-center">
          <input type="hidden" name="guideId" value={guide.id} />
          <button
            name="value"
            value="1"
            class="btn btn-ghost h-7 w-7 px-1"
            class:text-accent={voteOf(guide) === 1}
            aria-label={m.vote_up()}
            aria-pressed={voteOf(guide) === 1}
          >
            <ChevronUp size={18} />
          </button>
          <span class="tabular text-sm font-medium">{scoreOf(guide)}</span>
          <button
            name="value"
            value="-1"
            class="btn btn-ghost h-7 w-7 px-1"
            class:text-danger={voteOf(guide) === -1}
            aria-label={m.vote_down()}
            aria-pressed={voteOf(guide) === -1}
          >
            <ChevronDown size={18} />
          </button>
        </form>
        <div class="min-w-0 flex-1 space-y-2">
          <p class="flex items-center gap-2 text-xs text-muted">
            {#if guide.official}
              <span class="flex items-center gap-1 font-medium text-accent">
                <BookOpen size={12} aria-hidden="true" />{m.guide_badge()}
              </span>
              <span class="font-medium text-ink">{guide.author.displayName}</span>
            {:else}
              <a href="/u/{guide.author.handle}" class="font-medium text-ink">
                {guide.author.displayName}
              </a>
            {/if}
            {formatRelative(guide.createdAt)}
          </p>
          <div
            class="prose-user"
            use:guideChecks={{
              guideId: guide.id,
              checked: guide.checked,
              enabled: Boolean(data.user),
              html: shownHtml(guide),
            }}
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- assaini par renderGuide -->
            {@html shownHtml(guide)}
          </div>
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
    {/snippet}

    {#each shownGuides as guide (guide.id)}
      {@render guideCard(guide)}
    {:else}
      {#if !buriedGuides.length}
        <Empty title={data.masked ? m.guides_masked() : m.guides_empty()}>
          {data.masked ? m.guides_masked_text() : m.guides_empty_text()}
        </Empty>
      {/if}
    {/each}

    {#if buriedGuides.length}
      <button
        type="button"
        class="text-sm text-muted hover:text-ink"
        aria-expanded={showBuried}
        onclick={() => (showBuried = !showBuried)}
      >
        {showBuried ? m.guides_buried_hide() : m.guides_buried_show({ count: buriedGuides.length })}
      </button>
      {#if showBuried}
        <p class="text-xs text-muted">{m.guides_buried_note()}</p>
        {#each buriedGuides as guide (guide.id)}
          {@render guideCard(guide)}
        {/each}
      {/if}
    {/if}
  </section>

  <Discussion
    comments={data.comments}
    signedIn={Boolean(data.user)}
    signInHref="/connexion?retour=/succes/{data.achievement.id}"
    canTranslate={data.canTranslate}
  />
</div>
