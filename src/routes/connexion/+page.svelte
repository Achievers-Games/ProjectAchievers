<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import { PROVIDER_LABELS } from '$lib/labels';

  let { data } = $props();

  const options = $derived([
    { id: 'steam', provider: 'STEAM' },
    { id: 'discord', provider: 'DISCORD' },
    { id: 'xbox', provider: 'XBOX' },
    { id: 'google', provider: 'GOOGLE' },
  ] as const);
  const none = $derived(options.every((o) => !data.providers[o.provider]));
</script>

<svelte:head><title>{m.sign_in()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-sm space-y-6 py-10">
  <div class="space-y-1">
    <h1>{m.sign_in()}</h1>
    <p class="text-sm text-muted">{m.signin_tagline()}</p>
  </div>

  {#if data.error}
    <p role="alert" class="card px-3 py-2 text-sm text-danger">{data.error}</p>
  {/if}

  <div class="space-y-2">
    {#each options as option (option.id)}
      {#if data.providers[option.provider]}
        <!-- Lien classique : la navigation doit quitter le site vers le fournisseur. -->
        <a
          href="/auth/{option.id}/start?retour={encodeURIComponent(data.retour)}"
          data-sveltekit-reload
          class="btn h-11 w-full"
        >
          <ProviderIcon provider={option.provider} />
          {m.signin_with({ provider: PROVIDER_LABELS[option.provider] })}
        </a>
      {/if}
    {/each}
  </div>

  {#if none}
    <p class="text-sm text-muted">{m.signin_none()}</p>
  {/if}

  {#if data.devLogin}
    <a href="/auth/dev" data-sveltekit-reload class="btn btn-ghost w-full">
      {m.signin_demo()}
    </a>
  {/if}

  <p class="text-xs text-muted">
    {m.signin_psn_note()}
    <a href="/confidentialite" class="underline">{m.privacy()}</a>
  </p>
</div>
