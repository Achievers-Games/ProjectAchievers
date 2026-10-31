<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { Provider, SyncStatus } from '@prisma/client';
  import Avatar from '$lib/components/Avatar.svelte';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { formatRelative, PROVIDER_LABELS, syncErrorText } from '$lib/labels';
  import { FRAMES, frameHint, frameLabel } from '$lib/frames';
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
    STEAM: m.provider_library(),
    PSN: m.provider_trophies(),
    XBOX: m.provider_xbox(),
    DISCORD: m.provider_identity(),
    GOOGLE: m.provider_identity(),
  };
  const STATUS: Record<SyncStatus, string> = {
    IDLE: m.status_idle(),
    QUEUED: m.status_queued(),
    SYNCING: m.status_syncing(),
    COMPLETED: m.status_completed(),
    FAILED: m.status_failed(),
    NEEDS_RELINK: m.status_relink(),
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
          toast(String(result.data?.error ?? m.action_failed()), 'error');
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

<svelte:head><title>{m.my_account()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-8">
  <h1>{m.my_account()}</h1>

  {#if data.welcome}
    <p class="card px-3 py-2 text-sm">
      {m.account_welcome()}
    </p>
  {/if}
  {#if data.notice}
    <p role="alert" class="card px-3 py-2 text-sm text-danger">{data.notice}</p>
  {/if}

  {#if data.merge}
    <section class="card space-y-3 p-4" data-testid="fusion">
      <div class="space-y-1">
        <h2>{m.merge_title()}</h2>
        <p class="text-sm text-muted">
          {m.merge_text({
            name: data.merge.displayName,
            handle: data.merge.handle,
            providers: data.merge.providers.map((p) => PROVIDER_LABELS[p]).join(', '),
            games: m.count_games({ count: data.merge.games }),
            guides: m.count_guides({ count: data.merge.guides }),
            comments: m.count_comments({ count: data.merge.comments }),
          })}
        </p>
      </div>
      {#if data.merge.conflicts.length}
        <p role="alert" class="text-sm text-danger">
          {m.merge_conflict({
            providers: data.merge.conflicts.map((p) => PROVIDER_LABELS[p]).join(', '),
          })}
        </p>
      {:else}
        <p class="text-sm">
          {m.merge_warning({ handle: data.merge.handle })}
        </p>
      {/if}
      <div class="flex gap-2">
        {#if !data.merge.conflicts.length}
          <form method="POST" action="?/merge" use:enhance={submit}>
            <button class="btn btn-primary">{m.merge_action()}</button>
          </form>
        {/if}
        <form method="POST" action="?/mergeCancel" use:enhance={submit}>
          <button class="btn btn-ghost">{m.cancel()}</button>
        </form>
      </div>
    </section>
  {/if}

  <section class="space-y-3">
    <h2>{m.profile()}</h2>
    <form
      method="POST"
      action="?/profile"
      use:enhance={submitWith(true)}
      class="card space-y-4 p-4"
    >
      <div class="space-y-1">
        <label for="displayName" class="label block">{m.profile_name()}</label>
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
        <label for="handle" class="label block">{m.profile_handle()}</label>
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
          {m.profile_handle_help({ handle: data.profile.handle })}
        </p>
      </div>

      <fieldset class="space-y-2">
        <legend class="label">{m.profile_avatar()}</legend>
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
            {m.profile_initial()}
          </label>
        </div>
      </fieldset>

      <button class="btn btn-primary">{m.save()}</button>
    </form>
  </section>

  <section class="space-y-3">
    <h2>{m.frames_title()}</h2>
    <form method="POST" action="?/frame" use:enhance={submitWith(true)} class="card space-y-4 p-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex items-center gap-3 text-sm">
          <input type="radio" name="frame" value="" checked={!data.profile.frame} />
          <Avatar name={data.profile.displayName} src={data.profile.avatarUrl} size={36} />
          {m.frame_none()}
        </label>
        {#each FRAMES as frame (frame)}
          {@const owned = data.frames.includes(frame)}
          <label class="flex items-center gap-3 text-sm" class:opacity-50={!owned}>
            <input
              type="radio"
              name="frame"
              value={frame}
              disabled={!owned}
              checked={data.profile.frame === frame}
            />
            <Avatar
              name={data.profile.displayName}
              src={data.profile.avatarUrl}
              {frame}
              size={36}
            />
            <span>
              {frameLabel(frame)}
              {#if !owned}<span class="block text-xs text-muted">{frameHint(frame)}</span>{/if}
            </span>
          </label>
        {/each}
      </div>
      <button class="btn btn-primary">{m.save()}</button>
    </form>
  </section>

  <section class="space-y-3">
    <h2>{m.linked_accounts()}</h2>
    <ul class="card divide-y divide-line">
      {#each PROVIDERS as provider (provider)}
        {@const account = accounts.get(provider)}
        {@const live = $syncState[provider]}
        {@const status = live?.status ?? account?.syncStatus}
        {@const error = syncErrorText(live?.error ?? account?.syncError)}
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
                  {m.provider_disabled()}
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
                  {m.reconnect()}
                </a>
              {:else if !LOGIN_ONLY.includes(provider)}
                <form method="POST" action="?/sync" use:enhance={submit}>
                  <input type="hidden" name="provider" value={provider} />
                  <button class="btn" disabled={status === 'SYNCING' || status === 'QUEUED'}>
                    {m.synchronize()}
                  </button>
                </form>
              {/if}
              <form method="POST" action="?/unlink" use:enhance={submit}>
                <input type="hidden" name="provider" value={provider} />
                <button class="btn btn-ghost">{m.unlink()}</button>
              </form>
            {:else if available && OAUTH[provider]}
              <a class="btn" href="/auth/{OAUTH[provider]}/start" data-sveltekit-reload
                >{m.link()}</a
              >
            {/if}
          </div>

          {#if live?.status === 'SYNCING' && live.total > 0}
            <div class="space-y-1">
              <Progress value={(live.processed / live.total) * 100} label={m.synchronization()} />
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
                  {m.psn_instructions({ name: data.psn.onlineId })}
                </p>
                <p class="font-mono text-base font-semibold">{data.psn.code}</p>
                <p class="text-xs text-muted">
                  {m.psn_public_note()}
                </p>
                <div class="flex gap-2">
                  <form method="POST" action="?/psnConfirm" use:enhance={submit}>
                    <button class="btn btn-primary">{m.verify()}</button>
                  </form>
                  <form method="POST" action="?/psnCancel" use:enhance={submit}>
                    <button class="btn btn-ghost">{m.cancel()}</button>
                  </form>
                </div>
              </div>
            {:else}
              <form method="POST" action="?/psnStart" use:enhance={submit} class="flex gap-2">
                <input
                  name="onlineId"
                  required
                  aria-label={m.psn_id()}
                  placeholder={m.psn_id_placeholder()}
                  autocomplete="off"
                  class="input max-w-xs"
                />
                <button class="btn">{m.link()}</button>
              </form>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="space-y-3">
    <h2>{m.preferences()}</h2>
    <div class="card divide-y divide-line">
      <form
        method="POST"
        action="?/visibility"
        use:enhance={submit}
        class="flex items-center justify-between gap-4 p-4"
      >
        <label for="public" class="text-sm">
          <span class="font-medium">{m.public_profile()}</span>
          <span class="block text-xs text-muted">
            {m.public_profile_text()}
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
          <span class="font-medium">{m.adult_toggle()}</span>
          <span class="block text-xs text-muted">
            {m.adult_text()}
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
        <p class="text-sm font-medium">{m.theme()}</p>
        <div class="flex gap-2">
          <button name="theme" value="dark" class="btn" aria-pressed={data.theme === 'dark'}>
            {m.theme_dark()}
          </button>
          <button name="theme" value="light" class="btn" aria-pressed={data.theme === 'light'}>
            {m.theme_light()}
          </button>
        </div>
      </form>
    </div>
  </section>

  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <h2>{m.sessions()}</h2>
      {#if data.sessions.length > 1}
        <form method="POST" action="?/revokeOthers" use:enhance={submit}>
          <button class="btn btn-ghost">{m.sessions_revoke_others()}</button>
        </form>
      {/if}
    </div>
    <ul class="card divide-y divide-line">
      {#each data.sessions as session (session.id)}
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

  <section class="space-y-3">
    <h2>{m.personal_data()}</h2>
    <div class="card space-y-4 p-4">
      <a class="btn" href="/compte/export" data-sveltekit-reload>{m.export_data()}</a>
      <form method="POST" action="?/delete" use:enhance={submit} class="space-y-2">
        <label for="confirmation" class="label block">
          {m.delete_account_label({ handle: data.user?.handle ?? '' })}
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
            {m.delete()}
          </button>
        </div>
      </form>
    </div>
  </section>
</div>
