<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import PushChannels from '#lib/components/PushChannels.svelte';
  import { submitWithToast } from '#lib/forms';
  import {
    currentSubscription,
    disablePush,
    enablePush,
    pushFailureText,
    pushSupported,
  } from '#lib/push';
  import { toast } from '#lib/stores/toast';

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
  // Les cases partent du réglage enregistré, puis vivent leur vie jusqu'à l'envoi du formulaire.
  // svelte-ignore state_referenced_locally
  const channels = $state({
    messages: profile.pushMessages,
    invites: profile.pushInvites,
    events: profile.pushEvents,
  });

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
    } catch (cause) {
      toast(pushFailureText(cause), 'error');
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
          <PushChannels
            bind:messages={channels.messages}
            bind:invites={channels.invites}
            bind:events={channels.events}
            named
          />
          <button class="btn btn-primary">{m.save()}</button>
        </form>
      {/if}
    {/if}
  </div>
</section>
