<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { submitWithToast } from '#lib/forms';

  let { data } = $props();
  const submit = submitWithToast();
</script>

<svelte:head><title>{m.contact_title()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <h1>{m.contact_title()}</h1>
  <p class="text-sm text-muted">{m.contact_intro()}</p>

  {#if data.available}
    <form method="POST" action="?/send" use:enhance={submit} class="card space-y-3 p-4">
      <div class="space-y-1">
        <label for="contact-name" class="label block">{m.contact_name()}</label>
        <input
          id="contact-name"
          name="name"
          type="text"
          required
          minlength="2"
          maxlength="80"
          autocomplete="name"
          class="input"
        />
      </div>
      <div class="space-y-1">
        <label for="contact-email" class="label block">{m.contact_email()}</label>
        <input
          id="contact-email"
          name="email"
          type="email"
          required
          maxlength="200"
          autocomplete="email"
          class="input"
        />
      </div>
      <div class="space-y-1">
        <label for="contact-subject" class="label block">{m.contact_subject()}</label>
        <input id="contact-subject" name="subject" type="text" maxlength="120" class="input" />
      </div>
      <div class="space-y-1">
        <label for="contact-message" class="label block">{m.contact_message()}</label>
        <textarea
          id="contact-message"
          name="message"
          rows="6"
          required
          minlength="20"
          maxlength="4000"
          placeholder={m.contact_placeholder()}
          class="input h-auto py-2"></textarea>
      </div>
      <div class="hidden" aria-hidden="true">
        <label for="contact-website">Website</label>
        <input id="contact-website" name="website" type="text" tabindex="-1" autocomplete="off" />
      </div>
      <button class="btn btn-primary">{m.contact_send()}</button>
    </form>
  {:else}
    <p class="card p-4 text-sm">{m.contact_unavailable()}</p>
  {/if}
</div>
