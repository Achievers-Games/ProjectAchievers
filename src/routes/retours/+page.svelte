<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import SocialNav from '$lib/components/SocialNav.svelte';
  import { feedbackKindLabel, feedbackStatusLabel } from '$lib/feedback';
  import { submitWithToast } from '$lib/forms';
  import { formatRelative } from '$lib/labels';

  let { data } = $props();
  const submit = submitWithToast();
</script>

<svelte:head><title>{m.feedback_title()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <h1>{m.feedback_title()}</h1>
  <SocialNav />
  <p class="text-sm text-muted">{m.feedback_intro()}</p>

  <form method="POST" action="?/send" use:enhance={submit} class="card space-y-3 p-4">
    <fieldset class="flex gap-4">
      <legend class="sr-only">{m.feedback_kind()}</legend>
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="kind" value="BUG" checked />
        {m.feedback_bug()}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="kind" value="IDEA" />
        {m.feedback_idea()}
      </label>
    </fieldset>
    <textarea
      name="content"
      rows="6"
      required
      minlength="10"
      maxlength="4000"
      aria-label={m.feedback_content()}
      placeholder={m.feedback_placeholder()}
      class="input h-auto py-2"
    ></textarea>
    <button class="btn btn-primary">{m.feedback_send()}</button>
  </form>

  {#if data.sent.length}
    <section class="space-y-2">
      <h2>{m.feedback_mine()}</h2>
      <ul class="card divide-y divide-line">
        {#each data.sent as item (item.id)}
          <li class="space-y-1 p-3">
            <p class="text-xs text-muted">
              {feedbackKindLabel(item.kind)} · {feedbackStatusLabel(item.status)} ·
              {formatRelative(item.createdAt)}
            </p>
            <p class="whitespace-pre-wrap break-words text-sm">{item.content}</p>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
