<script lang="ts">
  import { m } from '#lib/paraglide/messages';

  let {
    messages = $bindable(true),
    invites = $bindable(true),
    events = $bindable(true),
    named = false,
  }: {
    messages?: boolean;
    invites?: boolean;
    events?: boolean;
    /** Dans un formulaire, chaque case porte le nom attendu par l'action serveur. */
    named?: boolean;
  } = $props();
</script>

<div class="space-y-1">
  <label class="flex items-center gap-2 text-sm">
    <input type="checkbox" bind:checked={messages} name={named ? 'messages' : undefined} />
    {m.push_messages()}
  </label>
  <label class="flex items-center gap-2 text-sm">
    <input type="checkbox" bind:checked={invites} name={named ? 'invites' : undefined} />
    {m.push_invites()}
  </label>
  <label class="flex items-center gap-2 text-sm">
    <input type="checkbox" bind:checked={events} name={named ? 'events' : undefined} />
    {m.push_events()}
  </label>
</div>
