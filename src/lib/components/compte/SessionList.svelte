<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { formatRelative } from '$lib/labels';
  import { submitWithToast } from '$lib/forms';

  let {
    sessions,
  }: {
    sessions: {
      id: string;
      userAgent: string | null;
      current: boolean;
      lastUsedAt: Date | string;
    }[];
  } = $props();

  const submit = submitWithToast();
</script>

<section class="space-y-3">
  <div class="flex items-center justify-between">
    <h2>{m.sessions()}</h2>
    {#if sessions.length > 1}
      <form method="POST" action="?/revokeOthers" use:enhance={submit}>
        <button class="btn btn-ghost">{m.sessions_revoke_others()}</button>
      </form>
    {/if}
  </div>
  <ul class="card divide-y divide-line">
    {#each sessions as session (session.id)}
      <li class="flex items-center gap-3 p-3 text-sm">
        <div class="min-w-0 flex-1">
          <p class="truncate">{session.userAgent ?? m.session_unknown_device()}</p>
          <p class="text-xs text-muted">
            {session.current ? m.session_this_device() : formatRelative(session.lastUsedAt)}
          </p>
        </div>
        {#if !session.current}
          <form method="POST" action="?/revokeSession" use:enhance={submit}>
            <input type="hidden" name="id" value={session.id} />
            <button class="btn btn-ghost">{m.session_revoke()}</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
  <form method="POST" action="/auth/deconnexion">
    <button class="btn">{m.sign_out()}</button>
  </form>
</section>
