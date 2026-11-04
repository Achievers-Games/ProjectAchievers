<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Avatar from '#lib/components/Avatar.svelte';
  import { submitWithToast } from '#lib/forms';

  let {
    profile,
    avatars,
  }: {
    profile: { displayName: string; handle: string; avatarUrl: string | null };
    avatars: [string, { label: string; motion: string | null }][];
  } = $props();

  const submit = submitWithToast({ reset: false });
</script>

<section class="space-y-3">
  <h2>{m.profile()}</h2>
  <form method="POST" action="?/profile" use:enhance={submit} class="card space-y-4 p-4">
    <div class="space-y-1">
      <label for="displayName" class="label block">{m.profile_name()}</label>
      <input
        id="displayName"
        name="displayName"
        value={profile.displayName}
        required
        minlength="2"
        maxlength="32"
        autocomplete="off"
        class="input max-w-xs"
      />
    </div>

    <div class="space-y-1">
      <label for="handle" class="label block">{m.profile_handle()}</label>
      <input
        id="handle"
        name="handle"
        value={profile.handle}
        required
        minlength="3"
        maxlength="24"
        autocomplete="off"
        spellcheck="false"
        class="input max-w-xs"
      />
      <p class="text-xs text-muted">
        {m.profile_handle_help({ handle: profile.handle })}
      </p>
    </div>

    <fieldset class="space-y-2">
      <legend class="label">{m.profile_avatar()}</legend>
      <div class="flex flex-wrap gap-4">
        {#each avatars as [url, { label, motion }] (url)}
          <label class="flex items-center gap-2 text-sm">
            <input type="radio" name="avatarUrl" value={url} checked={profile.avatarUrl === url} />
            <Avatar name={profile.displayName} src={url} {motion} play="always" size={28} />
            {label}
          </label>
        {/each}
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="avatarUrl" value="" checked={!profile.avatarUrl} />
          <Avatar name={profile.displayName} size={28} />
          {m.profile_initial()}
        </label>
      </div>
    </fieldset>

    <button class="btn btn-primary">{m.save()}</button>
  </form>
</section>
