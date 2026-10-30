<script lang="ts">
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';

  let { data } = $props();

  const options = $derived([
    { id: 'steam', provider: 'STEAM', label: 'Continuer avec Steam' },
    { id: 'discord', provider: 'DISCORD', label: 'Continuer avec Discord' },
    { id: 'xbox', provider: 'XBOX', label: 'Continuer avec Xbox' },
    { id: 'google', provider: 'GOOGLE', label: 'Continuer avec Google' },
  ] as const);
  const none = $derived(options.every((o) => !data.providers[o.provider]));
</script>

<svelte:head><title>Connexion — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-sm space-y-6 py-10">
  <div class="space-y-1">
    <h1>Connexion</h1>
    <p class="text-sm text-muted">
      Pas de mot de passe. Tous les comptes que tu lies ouvrent le même profil.
    </p>
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
          {option.label}
        </a>
      {/if}
    {/each}
  </div>

  {#if none}
    <p class="text-sm text-muted">Aucun mode de connexion n'est configuré sur ce serveur.</p>
  {/if}

  {#if data.devLogin}
    <a href="/auth/dev" data-sveltekit-reload class="btn btn-ghost w-full">
      Compte de démonstration
    </a>
  {/if}

  <p class="text-xs text-muted">
    PlayStation se lie depuis ton compte, une fois connecté. Voir la
    <a href="/confidentialite" class="underline">politique de confidentialité</a>.
  </p>
</div>
