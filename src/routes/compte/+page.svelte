<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { Provider, SyncStatus } from '@prisma/client';
  import Avatar from '$lib/components/Avatar.svelte';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { formatRelative, plural, PROVIDER_LABELS } from '$lib/labels';
  import { syncState } from '$lib/stores/sync';
  import { toast } from '$lib/stores/toast';

  let { data } = $props();

  let confirmation = $state('');

  const PROVIDERS: Provider[] = ['STEAM', 'PSN', 'XBOX', 'DISCORD', 'GOOGLE'];
  const OAUTH: Partial<Record<Provider, string>> = {
    STEAM: 'steam',
    DISCORD: 'discord',
    XBOX: 'xbox',
    GOOGLE: 'google',
  };
  const LOGIN_ONLY: Provider[] = ['DISCORD', 'GOOGLE'];
  const DESCRIPTIONS: Record<Provider, string> = {
    STEAM: 'Bibliothèque et succès',
    PSN: 'Trophées publics',
    XBOX: 'Succès et Gamerscore',
    DISCORD: 'Connexion et identité',
    GOOGLE: 'Connexion et identité',
  };
  const STATUS: Record<SyncStatus, string> = {
    IDLE: 'En attente',
    QUEUED: 'En file',
    SYNCING: 'Synchronisation…',
    COMPLETED: 'À jour',
    FAILED: 'Échec',
    NEEDS_RELINK: 'À reconnecter',
  };

  const accounts = $derived(new Map(data.accounts.map((a) => [a.provider, a])));
  const hasPsnSlot = $derived(!accounts.has('PSN') && data.providers.PSN);
  const avatars = $derived([
    ...new Map(
      data.accounts
        .filter((a) => a.avatarUrl)
        .map((a) => [a.avatarUrl, PROVIDER_LABELS[a.provider]]),
    ),
  ]);

  const submitWith =
    (keepValues: boolean): SubmitFunction =>
    () => {
      return async ({ result, update }) => {
        await update({ reset: !keepValues && result.type === 'success' });
        if (result.type === 'failure')
          toast(String(result.data?.error ?? 'Action impossible.'), 'error');
        else if (result.type === 'success' && result.data?.success)
          toast(String(result.data.success));
      };
    };
  const submit = submitWith(false);

  const applyTheme: SubmitFunction = ({ formData }) => {
    document.documentElement.dataset.theme = String(formData.get('theme'));
    return ({ update }) => update();
  };
</script>

<svelte:head><title>Mon compte — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-8">
  <h1>Mon compte</h1>

  {#if data.welcome}
    <p class="card px-3 py-2 text-sm">
      Bienvenue ! Ta synchronisation démarre. Ton nom vient de ton compte : tu peux le changer
      ci-dessous, et lier d'autres comptes.
    </p>
  {/if}
  {#if data.notice}
    <p role="alert" class="card px-3 py-2 text-sm text-danger">{data.notice}</p>
  {/if}

  {#if data.merge}
    <section class="card space-y-3 p-4" data-testid="fusion">
      <div class="space-y-1">
        <h2>Fusionner tes profils</h2>
        <p class="text-sm text-muted">
          Ce compte appartient déjà au profil <strong>{data.merge.displayName}</strong>
          (@{data.merge.handle}) : {data.merge.providers.map((p) => PROVIDER_LABELS[p]).join(', ')}, {plural(
            data.merge.games,
            'jeu',
            'jeux',
          )},
          {plural(data.merge.guides, 'guide')}, {plural(data.merge.comments, 'commentaire')}.
        </p>
      </div>
      {#if data.merge.conflicts.length}
        <p role="alert" class="text-sm text-danger">
          Les deux profils ont un compte {data.merge.conflicts
            .map((p) => PROVIDER_LABELS[p])
            .join(', ')}. Dissocie-le de ce profil avant de fusionner.
        </p>
      {:else}
        <p class="text-sm">
          Tout sera rattaché au profil actuel, puis @{data.merge.handle} sera supprimé. Cette action est
          définitive.
        </p>
      {/if}
      <div class="flex gap-2">
        {#if !data.merge.conflicts.length}
          <form method="POST" action="?/merge" use:enhance={submit}>
            <button class="btn btn-primary">Fusionner</button>
          </form>
        {/if}
        <form method="POST" action="?/mergeCancel" use:enhance={submit}>
          <button class="btn btn-ghost">Annuler</button>
        </form>
      </div>
    </section>
  {/if}

  <section class="space-y-3">
    <h2>Profil</h2>
    <form
      method="POST"
      action="?/profile"
      use:enhance={submitWith(true)}
      class="card space-y-4 p-4"
    >
      <div class="space-y-1">
        <label for="displayName" class="label block">Nom affiché</label>
        <input
          id="displayName"
          name="displayName"
          value={data.profile.displayName}
          required
          minlength="2"
          maxlength="32"
          autocomplete="off"
          class="input max-w-xs"
        />
      </div>

      <div class="space-y-1">
        <label for="handle" class="label block">Identifiant</label>
        <input
          id="handle"
          name="handle"
          value={data.profile.handle}
          required
          minlength="3"
          maxlength="24"
          autocomplete="off"
          spellcheck="false"
          class="input max-w-xs"
        />
        <p class="text-xs text-muted">
          Ton profil est à l'adresse /u/{data.profile.handle}. En le changeant, les anciens liens ne
          fonctionneront plus.
        </p>
      </div>

      <fieldset class="space-y-2">
        <legend class="label">Avatar</legend>
        <div class="flex flex-wrap gap-4">
          {#each avatars as [url, label] (url)}
            <label class="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="avatarUrl"
                value={url}
                checked={data.profile.avatarUrl === url}
              />
              <Avatar name={data.profile.displayName} src={url} size={28} />
              {label}
            </label>
          {/each}
          <label class="flex items-center gap-2 text-sm">
            <input type="radio" name="avatarUrl" value="" checked={!data.profile.avatarUrl} />
            <Avatar name={data.profile.displayName} size={28} />
            Initiale
          </label>
        </div>
      </fieldset>

      <button class="btn btn-primary">Enregistrer</button>
    </form>
  </section>

  <section class="space-y-3">
    <h2>Comptes liés</h2>
    <ul class="card divide-y divide-line">
      {#each PROVIDERS as provider (provider)}
        {@const account = accounts.get(provider)}
        {@const live = $syncState[provider]}
        {@const status = live?.status ?? account?.syncStatus}
        {@const error = live?.error ?? account?.syncError}
        {@const available = data.providers[provider]}
        <li class="space-y-2 p-4" data-provider={provider}>
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-muted"><ProviderIcon {provider} size={20} /></span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium">{PROVIDER_LABELS[provider]}</p>
              <p class="truncate text-xs text-muted">
                {#if account}
                  {account.displayName}
                  {#if !LOGIN_ONLY.includes(provider) && status}· {STATUS[status]}{/if}
                  {#if account.lastSyncedAt && status === 'COMPLETED'}
                    · {formatRelative(account.lastSyncedAt)}
                  {/if}
                {:else if !available}
                  Non activé sur ce serveur
                {:else}
                  {DESCRIPTIONS[provider]}
                {/if}
              </p>
            </div>

            {#if account}
              {#if status === 'NEEDS_RELINK' && OAUTH[provider]}
                <a
                  class="btn btn-primary"
                  href="/auth/{OAUTH[provider]}/start"
                  data-sveltekit-reload
                >
                  Reconnecter
                </a>
              {:else if !LOGIN_ONLY.includes(provider)}
                <form method="POST" action="?/sync" use:enhance={submit}>
                  <input type="hidden" name="provider" value={provider} />
                  <button class="btn" disabled={status === 'SYNCING' || status === 'QUEUED'}>
                    Synchroniser
                  </button>
                </form>
              {/if}
              <form method="POST" action="?/unlink" use:enhance={submit}>
                <input type="hidden" name="provider" value={provider} />
                <button class="btn btn-ghost">Dissocier</button>
              </form>
            {:else if available && OAUTH[provider]}
              <a class="btn" href="/auth/{OAUTH[provider]}/start" data-sveltekit-reload>Lier</a>
            {/if}
          </div>

          {#if live?.status === 'SYNCING' && live.total > 0}
            <div class="space-y-1">
              <Progress value={(live.processed / live.total) * 100} label="Synchronisation" />
              <p class="tabular truncate text-xs text-muted">
                {live.processed} / {live.total} · {live.game}
              </p>
            </div>
          {/if}

          {#if error}
            <p class="text-xs text-danger">{error}</p>
          {/if}

          {#if provider === 'PSN' && hasPsnSlot}
            {#if data.psn}
              <div class="space-y-2 rounded bg-raised p-3 text-sm">
                <p>
                  Ajoute ce code à la bio de <strong>{data.psn.onlineId}</strong>, depuis ta console
                  ou l'application PlayStation, puis vérifie :
                </p>
                <p class="font-mono text-base font-semibold">{data.psn.code}</p>
                <p class="text-xs text-muted">
                  Tes trophées doivent aussi être visibles par tout le monde. Tu pourras retirer le
                  code ensuite.
                </p>
                <div class="flex gap-2">
                  <form method="POST" action="?/psnConfirm" use:enhance={submit}>
                    <button class="btn btn-primary">Vérifier</button>
                  </form>
                  <form method="POST" action="?/psnCancel" use:enhance={submit}>
                    <button class="btn btn-ghost">Annuler</button>
                  </form>
                </div>
              </div>
            {:else}
              <form method="POST" action="?/psnStart" use:enhance={submit} class="flex gap-2">
                <input
                  name="onlineId"
                  required
                  aria-label="Identifiant PSN"
                  placeholder="Ton identifiant PSN"
                  autocomplete="off"
                  class="input max-w-xs"
                />
                <button class="btn">Lier</button>
              </form>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="space-y-3">
    <h2>Préférences</h2>
    <div class="card divide-y divide-line">
      <form
        method="POST"
        action="?/visibility"
        use:enhance={submit}
        class="flex items-center justify-between gap-4 p-4"
      >
        <label for="public" class="text-sm">
          <span class="font-medium">Profil public</span>
          <span class="block text-xs text-muted">
            Ton profil et tes succès sont visibles par tous et apparaissent au classement.
          </span>
        </label>
        <input
          id="public"
          name="isPublic"
          type="checkbox"
          checked={data.profile.isPublic}
          onchange={(event) => event.currentTarget.form?.requestSubmit()}
        />
      </form>

      <form
        method="POST"
        action="?/adult"
        use:enhance={submit}
        class="flex items-center justify-between gap-4 p-4"
      >
        <label for="adult" class="text-sm">
          <span class="font-medium">Afficher les jeux pour adultes</span>
          <span class="block text-xs text-muted">
            Les jeux Steam classés « Nudité fréquente ou contenu à caractère sexuel » ou « Contenu à
            caractère sexuel réservé aux adultes » sont masqués par défaut.
          </span>
        </label>
        <input
          id="adult"
          name="showAdult"
          type="checkbox"
          checked={data.profile.showAdult}
          onchange={(event) => event.currentTarget.form?.requestSubmit()}
        />
      </form>

      <form
        method="POST"
        action="?/theme"
        use:enhance={applyTheme}
        class="flex items-center justify-between gap-4 p-4"
      >
        <p class="text-sm font-medium">Thème</p>
        <div class="flex gap-2">
          <button name="theme" value="dark" class="btn" aria-pressed={data.theme === 'dark'}>
            Sombre
          </button>
          <button name="theme" value="light" class="btn" aria-pressed={data.theme === 'light'}>
            Clair
          </button>
        </div>
      </form>
    </div>
  </section>

  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <h2>Sessions</h2>
      {#if data.sessions.length > 1}
        <form method="POST" action="?/revokeOthers" use:enhance={submit}>
          <button class="btn btn-ghost">Déconnecter les autres</button>
        </form>
      {/if}
    </div>
    <ul class="card divide-y divide-line">
      {#each data.sessions as session (session.id)}
        <li class="flex items-center gap-3 p-3 text-sm">
          <div class="min-w-0 flex-1">
            <p class="truncate">{session.userAgent ?? 'Appareil inconnu'}</p>
            <p class="text-xs text-muted">
              {session.current ? 'Cet appareil' : formatRelative(session.lastUsedAt)}
            </p>
          </div>
          {#if !session.current}
            <form method="POST" action="?/revokeSession" use:enhance={submit}>
              <input type="hidden" name="id" value={session.id} />
              <button class="btn btn-ghost">Déconnecter</button>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
    <form method="POST" action="/auth/deconnexion">
      <button class="btn">Se déconnecter</button>
    </form>
  </section>

  <section class="space-y-3">
    <h2>Données personnelles</h2>
    <div class="card space-y-4 p-4">
      <a class="btn" href="/compte/export" data-sveltekit-reload>Exporter mes données</a>
      <form method="POST" action="?/delete" use:enhance={submit} class="space-y-2">
        <label for="confirmation" class="label block">
          Pour supprimer définitivement ton compte, saisis « {data.user?.handle} »
        </label>
        <div class="flex gap-2">
          <input
            id="confirmation"
            name="confirmation"
            bind:value={confirmation}
            autocomplete="off"
            class="input max-w-xs"
          />
          <button class="btn btn-danger" disabled={confirmation !== data.user?.handle}>
            Supprimer
          </button>
        </div>
      </form>
    </div>
  </section>
</div>
