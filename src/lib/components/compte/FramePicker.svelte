<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import type { Provider } from '@prisma/client';
  import Avatar from '$lib/components/Avatar.svelte';
  import { FRAMES, frameHint, frameLabel } from '$lib/frames';
  import { PROVIDER_LABELS } from '$lib/labels';
  import { submitWithToast } from '$lib/forms';

  let {
    profile,
    accounts,
    frames,
  }: {
    profile: {
      displayName: string;
      avatarUrl: string | null;
      avatarMotionUrl: string | null;
      frame: string | null;
      frameMotionUrl: string | null;
      [key: string]: unknown;
    };
    accounts: {
      provider: Provider;
      frameUrl: string | null;
      frameMotionUrl: string | null;
    }[];
    frames: string[];
  } = $props();

  const submit = submitWithToast({ reset: false });

  /** Aperçu d'un cadre sur l'avatar du joueur, animation comprise. */
  const framed = (frame: string | null, frameMotionUrl: string | null = null) => ({
    ...profile,
    handle: undefined,
    frame,
    frameMotionUrl,
  });
</script>

<section class="space-y-3">
  <h2>{m.frames_title()}</h2>
  <form method="POST" action="?/frame" use:enhance={submit} class="card space-y-4 p-4">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="flex items-center gap-3 text-sm">
        <input type="radio" name="frame" value="" checked={!profile.frame} />
        <Avatar person={framed(null)} play="always" size={64} />
        {m.frame_none()}
      </label>
      {#each accounts.filter((a) => a.frameUrl) as account (account.provider)}
        <label class="flex items-center gap-3 text-sm">
          <input
            type="radio"
            name="frame"
            value="compte:{account.provider}"
            checked={profile.frame === account.frameUrl}
          />
          <Avatar
            person={framed(account.frameUrl, account.frameMotionUrl)}
            play="always"
            size={64}
          />
          {PROVIDER_LABELS[account.provider]}
        </label>
      {/each}
      {#each FRAMES as frame (frame)}
        {@const owned = frames.includes(frame)}
        <label class="flex items-center gap-3 text-sm" class:opacity-50={!owned}>
          <input
            type="radio"
            name="frame"
            value={frame}
            disabled={!owned}
            checked={profile.frame === frame}
          />
          <Avatar person={framed(frame)} play="always" size={64} />
          <span>
            {frameLabel(frame)}
            {#if !owned}<span class="block text-xs text-muted">{frameHint(frame)}</span>{/if}
          </span>
        </label>
      {/each}
    </div>
    <button class="btn btn-primary">{m.save()}</button>
  </form>
</section>
