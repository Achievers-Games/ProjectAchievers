<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { submitWithToast } from '$lib/forms';

  let {
    profile,
    theme,
  }: {
    profile: {
      isPublic: boolean;
      showOnline: boolean;
      showAdult: boolean;
      allowProfanity: boolean;
    };
    theme: string;
  } = $props();

  const submit = submitWithToast({ reset: false });

  const applyTheme: SubmitFunction = ({ formData }) => {
    document.documentElement.dataset.theme = String(formData.get('theme'));
    return ({ update }) => update();
  };
</script>

<section class="space-y-3">
  <h2>{m.preferences()}</h2>
  <div class="card divide-y divide-line">
    <form
      method="POST"
      action="?/visibility"
      use:enhance={submit}
      class="flex items-center justify-between gap-4 p-4"
    >
      <label for="public" class="text-sm">
        <span class="font-medium">{m.public_profile()}</span>
        <span class="block text-xs text-muted">
          {m.public_profile_text()}
        </span>
      </label>
      <input
        id="public"
        name="isPublic"
        type="checkbox"
        checked={profile.isPublic}
        onchange={(event) => event.currentTarget.form?.requestSubmit()}
      />
    </form>
    <form
      method="POST"
      action="?/presence"
      use:enhance={submit}
      class="flex items-center justify-between gap-4 p-4"
    >
      <label for="show-online" class="text-sm">
        <span class="font-medium">{m.online_status()}</span>
        <span class="block text-xs text-muted">{m.online_status_text()}</span>
      </label>
      <input
        id="show-online"
        name="showOnline"
        type="checkbox"
        checked={profile.showOnline}
        onchange={(event) => event.currentTarget.form?.requestSubmit()}
      />
    </form>

    <form
      method="POST"
      action="?/adult"
      use:enhance={submit}
      class="flex items-center justify-between gap-4 p-4"
    >
      <label for="adult" class="text-sm">
        <span class="font-medium">{m.adult_toggle()}</span>
        <span class="block text-xs text-muted">
          {m.adult_text()}
        </span>
      </label>
      <input
        id="adult"
        name="showAdult"
        type="checkbox"
        checked={profile.showAdult}
        onchange={(event) => event.currentTarget.form?.requestSubmit()}
      />
    </form>

    <form
      method="POST"
      action="?/profanity"
      use:enhance={submit}
      class="flex items-center justify-between gap-4 p-4"
    >
      <label for="profanity" class="text-sm">
        <span class="font-medium">{m.profanity_toggle()}</span>
        <span class="block text-xs text-muted">{m.profanity_text()}</span>
      </label>
      <input
        id="profanity"
        name="allowProfanity"
        type="checkbox"
        checked={profile.allowProfanity}
        onchange={(event) => event.currentTarget.form?.requestSubmit()}
      />
    </form>

    <form
      method="POST"
      action="?/theme"
      use:enhance={applyTheme}
      class="flex items-center justify-between gap-4 p-4"
    >
      <p class="text-sm font-medium">{m.theme()}</p>
      <div class="flex gap-2">
        <button name="theme" value="dark" class="btn" aria-pressed={theme === 'dark'}>
          {m.theme_dark()}
        </button>
        <button name="theme" value="light" class="btn" aria-pressed={theme === 'light'}>
          {m.theme_light()}
        </button>
        <button name="theme" value="system" class="btn" aria-pressed={theme === 'system'}>
          {m.theme_system()}
        </button>
      </div>
    </form>
  </div>
</section>
