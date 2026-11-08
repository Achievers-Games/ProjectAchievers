<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';

  let { data, form } = $props();

  const heading = $derived(data.guide ? m.game_guide_edit_title() : m.game_guide_new_title());
</script>

<svelte:head>
  <title>{heading} — {data.game.name}</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
  <a
    href="/jeux/{data.game.slug}"
    class="flex items-center gap-1 text-sm text-muted hover:text-ink"
  >
    <ArrowLeft size={14} aria-hidden="true" />
    {data.game.name}
  </a>
  <h1>{heading}</h1>

  <div class="card space-y-1 p-3 text-sm text-muted">
    <p>{m.game_guide_help()}</p>
    <p>{m.game_guide_syntax()}</p>
  </div>

  <form method="POST" use:enhance class="space-y-3">
    {#if data.guide}<input type="hidden" name="id" value={data.guide.id} />{/if}
    {#if form?.error}<p class="text-sm text-danger" role="alert">{form.error}</p>{/if}
    <div class="space-y-1">
      <label class="label" for="guide-title">{m.game_guide_title_label()}</label>
      <input
        id="guide-title"
        name="title"
        required
        minlength="3"
        maxlength="120"
        class="input"
        placeholder={m.game_guide_title_placeholder()}
        value={form?.title ?? data.guide?.title ?? ''}
      />
    </div>
    <div class="space-y-1">
      <label class="label" for="guide-content">{m.game_guide_content_label()}</label>
      <textarea
        id="guide-content"
        name="content"
        rows="24"
        required
        minlength="30"
        maxlength={data.maxLength}
        class="input h-auto py-2 font-mono text-[13px]"
        placeholder={m.game_guide_content_placeholder()}
        value={form?.content ?? data.guide?.content ?? ''}></textarea>
    </div>
    <button class="btn btn-primary">{data.guide ? m.save() : m.publish()}</button>
  </form>
</div>
