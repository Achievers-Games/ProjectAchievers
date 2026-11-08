<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { formatDate, scopeLabel } from '#lib/labels';
  import { submitWithToast } from '#lib/forms';

  interface OAuthApp {
    scopes: string[];
    createdAt: Date | string;
    app: { id: string; name: string };
  }

  let { apps }: { apps: OAuthApp[] } = $props();

  const submit = submitWithToast();
</script>

{#if apps.length}
  <section class="space-y-3">
    <h2>{m.oauth_apps()}</h2>
    <ul class="card divide-y divide-line">
      {#each apps as grant (grant.app.id)}
        <li class="flex flex-wrap items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1 space-y-1">
            <p class="font-medium">{grant.app.name}</p>
            <p class="text-sm text-muted">
              {grant.scopes.map(scopeLabel).join(' · ')}
            </p>
            <p class="text-xs text-muted">
              {m.oauth_apps_since({ date: formatDate(grant.createdAt) })}
            </p>
          </div>
          <form method="POST" action="?/revokeApp" use:enhance={submit}>
            <input type="hidden" name="app" value={grant.app.id} />
            <button class="btn btn-ghost">{m.oauth_app_revoke()}</button>
          </form>
        </li>
      {/each}
    </ul>
  </section>
{/if}
