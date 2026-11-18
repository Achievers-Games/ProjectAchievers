<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '$app/forms';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Flag from '@lucide/svelte/icons/flag';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Avatar from '#lib/components/Avatar.svelte';
  import Discussion from '#lib/components/Discussion.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import TranslateButton from '#lib/components/TranslateButton.svelte';
  import { guideChecks } from '#lib/actions/guide-checks';
  import { outlineOf } from '#lib/guide-outline';
  import { formatRelative } from '#lib/labels';
  import { postAction, reportContent } from '#lib/forms';
  import { Translations } from '#lib/translations.svelte';
  import { toast } from '#lib/stores/toast';

  let { data } = $props();

  /** Le vote optimiste vit ici : `data` appartient à la route et serait écrasé au moindre rechargement. */
  let vote = $state<{ score: number; myVote: number } | null>(null);
  const score = $derived(vote?.score ?? data.guide.score);
  const myVote = $derived(vote?.myVote ?? data.guide.myVote);

  const translations = new Translations(() => postAction('translate'));
  let done = $state<number | null>(null);
  let content = $state<HTMLElement>();

  const html = $derived(translations.html(data.guide));
  const outline = $derived(outlineOf(html));
  const progress = $derived(done ?? data.guide.checked.length);

  const submitVote: SubmitFunction = ({ formData }) => {
    const value = Number(formData.get('value'));
    const next = myVote === value ? 0 : value;
    vote = { score: score + next - myVote, myVote: next };
    return async ({ result }) => {
      if (result.type === 'redirect') location.assign(result.location);
      else if (result.type === 'success' && result.data) {
        vote = { score: Number(result.data.score), myVote: Number(result.data.myVote) };
      } else {
        vote = null;
        toast(m.action_failed(), 'error');
      }
    };
  };

  $effect(() => translations.auto([data.guide]));

  const countChecked = () => {
    done = content?.querySelectorAll('input[data-check]:checked').length ?? 0;
  };
</script>

<Seo
  title="{data.guide.title} — {data.game.name}"
  description={data.guide.excerpt || m.game_guides_text()}
  path={data.canonicalPath}
  type="article"
  jsonLd={{
    '@type': 'Article',
    headline: data.guide.title,
    about: { '@type': 'VideoGame', name: data.game.name },
    author: { '@type': 'Person', name: data.guide.author.displayName },
    datePublished: new Date(data.guide.createdAt).toISOString(),
    dateModified: new Date(data.guide.updatedAt).toISOString(),
  }}
  breadcrumbs={[
    { name: m.nav_games(), path: '/jeux' },
    { name: data.game.name, path: `/jeux/${data.game.slug}` },
    { name: data.guide.title, path: data.canonicalPath },
  ]}
/>

<div class="mx-auto max-w-5xl space-y-6">
  <header class="space-y-3">
    <a
      href="/jeux/{data.game.slug}"
      class="flex items-center gap-1 text-sm text-muted hover:text-ink"
    >
      <ArrowLeft size={14} aria-hidden="true" />
      {data.game.name}
    </a>
    <div class="flex gap-3">
      <form
        method="POST"
        action="?/vote"
        use:enhance={submitVote}
        class="flex flex-col items-center"
      >
        <button
          name="value"
          value="1"
          class="btn btn-ghost h-7 w-7 px-1"
          class:text-accent={myVote === 1}
          aria-label={m.vote_up()}
          aria-pressed={myVote === 1}
        >
          <ChevronUp size={18} />
        </button>
        <span class="tabular text-sm font-medium" data-testid="guide-score">{score}</span>
        <button
          name="value"
          value="-1"
          class="btn btn-ghost h-7 w-7 px-1"
          class:text-danger={myVote === -1}
          aria-label={m.vote_down()}
          aria-pressed={myVote === -1}
        >
          <ChevronDown size={18} />
        </button>
      </form>
      <div class="min-w-0 space-y-1">
        <h1>{data.guide.title}</h1>
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {#if data.guide.official}
            <span class="flex items-center gap-1 font-medium text-accent">
              <BookOpen size={12} aria-hidden="true" />{m.guide_badge()}
            </span>
            <span class="font-medium text-ink">{data.guide.author.displayName}</span>
          {:else}
            <a href="/u/{data.guide.author.handle}" class="flex items-center gap-1.5 text-ink">
              <Avatar person={data.guide.author} size={18} />
              <span class="font-medium">{data.guide.author.displayName}</span>
            </a>
          {/if}
          <span>{m.game_guide_updated({ when: formatRelative(data.guide.updatedAt) })}</span>
          {#if data.guide.steps}
            <span class="tabular" data-testid="guide-progress">
              · {m.game_guide_steps({ done: progress, total: data.guide.steps })}
            </span>
          {/if}
        </p>
        <div class="flex flex-wrap gap-3 pt-1">
          {#if data.canTranslate && !data.guide.mine}
            <TranslateButton {translations} item={data.guide} />
          {/if}
          {#if data.canEditOfficial}
            <a
              class="text-xs text-muted hover:text-ink"
              href="/jeux/{data.game.slug}/guides/ecrire?id={data.guide.id}"
            >
              {m.game_guide_edit()}
            </a>
          {/if}
          {#if data.guide.mine && !data.guide.official}
            <a
              class="text-xs text-muted hover:text-ink"
              href="/jeux/{data.game.slug}/guides/ecrire?id={data.guide.id}"
            >
              {m.game_guide_edit()}
            </a>
            <form
              method="POST"
              action="?/delete"
              use:enhance={({ cancel }) => {
                if (!confirm(m.game_guide_delete_confirm())) cancel();
              }}
            >
              <button class="text-xs text-muted hover:text-danger">{m.delete()}</button>
            </form>
          {:else if data.user}
            <button
              type="button"
              class="flex items-center gap-1 text-xs text-muted hover:text-ink"
              onclick={() => reportContent('report')}
            >
              <Flag size={12} aria-hidden="true" />
              {m.report()}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </header>

  {#if data.guide.buried}
    <div class="card missables-alert flex items-start gap-3 p-3 text-sm" role="note">
      <TriangleAlert size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <p>{m.game_guide_buried_warning()}</p>
    </div>
  {/if}
  <p class="text-xs text-muted">{m.game_guide_spoiler()}</p>

  <div class="grid gap-6 lg:grid-cols-[14rem_1fr]">
    {#if outline.length}
      <nav
        class="guide-outline card h-fit p-3 text-sm lg:sticky lg:top-20"
        aria-label={m.game_guide_outline()}
      >
        <p class="mb-2 font-medium">{m.game_guide_outline()}</p>
        <ol class="space-y-1">
          {#each outline as entry (entry.id)}
            <li class:pl-3={entry.level === 3}>
              <a href="#{entry.id}" class="block text-muted hover:text-ink">{entry.text}</a>
            </li>
          {/each}
        </ol>
      </nav>
    {/if}
    <article
      bind:this={content}
      class={['prose-user guide-long min-w-0', !outline.length && 'lg:col-span-2']}
      onchange={countChecked}
      use:guideChecks={{
        guideId: data.guide.id,
        checked: data.guide.checked,
        enabled: Boolean(data.user),
        html,
      }}
    >
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- assaini par renderGuide -->
      {@html html}
    </article>
  </div>

  <div class="lg:ml-[15.5rem]">
    <Discussion
      comments={data.comments}
      signedIn={Boolean(data.user)}
      signInHref="/connexion?retour=/jeux/{data.game.slug}/guides/{data.guide.id}"
      canTranslate={data.canTranslate}
    />
  </div>
</div>
