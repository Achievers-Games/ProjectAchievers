<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import PushChannels from '#lib/components/PushChannels.svelte';
  import { sendJson } from '#lib/http';
  import { currentSubscription, enablePush, pushFailureText, pushSupported } from '#lib/push';
  import { toast } from '#lib/stores/toast';

  /** Deux minutes passées sur le site, onglet visible : le joueur a eu le temps de s'installer. */
  const SECONDS_BEFORE = 120;
  const TICK = 10;
  const SNOOZE = 30 * 24 * 60 * 60 * 1000;
  const TIME_KEY = 'pa_push_temps';
  const LATER_KEY = 'pa_push_plus_tard';

  let { publicKey }: { publicKey: string | null } = $props();

  let shown = $state(false);
  let busy = $state(false);
  let messages = $state(true);
  let invites = $state(true);
  let events = $state(true);

  const read = (key: string) => {
    try {
      return Number(localStorage.getItem(key)) || 0;
    } catch {
      return 0;
    }
  };

  const write = (key: string, value: number) => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Stockage indisponible : la popup reviendra simplement plus tard.
    }
  };

  onMount(() => {
    if (!publicKey || !pushSupported() || Notification.permission !== 'default') return;
    if (Date.now() - read(LATER_KEY) < SNOOZE) return;

    let spent = read(TIME_KEY);
    const timer = setInterval(async () => {
      if (document.hidden) return;
      spent += TICK;
      write(TIME_KEY, spent);
      if (spent < SECONDS_BEFORE) return;
      clearInterval(timer);
      shown = !(await currentSubscription());
    }, TICK * 1000);
    return () => clearInterval(timer);
  });

  function later() {
    write(LATER_KEY, Date.now());
    shown = false;
  }

  async function activate() {
    if (!publicKey) return;
    busy = true;
    try {
      const enabled = await enablePush(publicKey);
      if (enabled) {
        await sendJson('/api/push', { messages, invites, events }, 'PATCH');
        toast(m.push_prompt_done());
      } else {
        toast(m.push_denied(), 'error');
      }
      later();
    } catch (cause) {
      toast(pushFailureText(cause), 'error');
    }
    busy = false;
  }
</script>

{#if shown}
  <div
    role="dialog"
    aria-label={m.push_prompt_title()}
    transition:fly={{ y: 24 }}
    class="push-prompt card space-y-3 p-4 shadow-lg"
  >
    <p class="font-semibold">{m.push_prompt_title()}</p>
    <p class="text-sm text-muted">{m.push_prompt_text()}</p>
    <PushChannels bind:messages bind:invites bind:events />
    <div class="flex gap-2">
      <button type="button" class="btn btn-primary flex-1" disabled={busy} onclick={activate}>
        {m.push_prompt_yes()}
      </button>
      <button type="button" class="btn" onclick={later}>{m.push_prompt_later()}</button>
    </div>
  </div>
{/if}
