<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { scopeLabel } from '#lib/labels';

  let { data } = $props();
</script>

<svelte:head>
  <title>{m.oauth_title({ app: data.app })} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-md space-y-6 py-10">
  <div class="space-y-1">
    <h1>{m.oauth_title({ app: data.app })}</h1>
    <p class="text-sm text-muted">{m.oauth_intro({ app: data.app })}</p>
  </div>

  <ul class="card divide-y divide-line text-sm">
    {#each data.scopes as scope (scope)}
      <li class="px-4 py-3">{scopeLabel(scope)}</li>
    {/each}
  </ul>

  <p class="text-xs text-muted">{m.oauth_never()}</p>

  <form method="POST" class="flex gap-3">
    <input type="hidden" name="query" value={data.query} />
    <button class="btn btn-primary flex-1" formaction="?/approve">{m.oauth_approve()}</button>
    <button class="btn flex-1" formaction="?/deny">{m.oauth_deny()}</button>
  </form>

  <p class="text-xs text-muted">{m.oauth_revoke_hint()}</p>
</div>
