<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import { submitWithToast } from '$lib/forms';
  import { currentSubscription, disablePush, enablePush, pushSupported } from '$lib/push';
  import { toast } from '$lib/stores/toast';

  let {
    publicKey,
    profile,
  }: {
    publicKey: string | null;
    profile: { pushMessages: boolean; pushInvites: boolean; pushEvents: boolean };
  } = $props();

  let supported = $state(false);
  let enabled = $state(false);
  let busy = $state(false);

  const submit = submitWithToast({ reset: false });

  onMount(async () => {
    supported = pushSupported() && Boolean(publicKey);
    if (supported) enabled = Boolean(await currentSubscription());
  });

  async function toggle() {
    if (!publicKey) return;
    busy = true;
    try {
      if (enabled) {
        await disablePush();
        enabled = false;
      } else {
        enabled = await enablePush(publicKey);
        if (!enabled) toast(m.push_denied(), 'error');
      }
    } catch {
      toast(m.action_failed(), 'error');
    }
    busy = false;
  }
</script>

<section class="space-y-3">
  <h2>{m.push_title()}</h2>
  <div class="card space-y-3 p-4">
    <p class="text-sm text-muted">{supported ? m.push_help() : m.push_unsupported()}</p>
    {#if supported}
      <button type="button" class="btn" disabled={busy} onclick={toggle}>
        {enabled ? m.push_disable() : m.push_enable()}
      </button>
      {#if enabled}
        <form method="POST" action="?/notifications" use:enhance={submit} class="space-y-2">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="messages" checked={profile.pushMessages} />
            {m.push_messages()}
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="invites" checked={profile.pushInvites} />
            {m.push_invites()}
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="events" checked={profile.pushEvents} />
            {m.push_events()}
          </label>
          <button class="btn btn-primary">{m.save()}</button>
        </form>
      {/if}
    {/if}
  </div>
</section>
