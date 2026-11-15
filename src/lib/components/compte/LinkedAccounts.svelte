<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import type { Provider, SyncStatus } from '#prisma';
  import ProviderIcon from '#lib/components/ProviderIcon.svelte';
  import Progress from '#lib/components/Progress.svelte';
  import { formatRelative, PROVIDER_LABELS, syncErrorText } from '#lib/labels';
  import { latestSyncError, syncState } from '#lib/stores/sync';
  import { submitWithToast } from '#lib/forms';
  import {
    DESCRIPTIONS,
    isClosedError,
    LOGIN_ONLY,
    OAUTH,
    PRIVACY,
    PROVIDERS,
    STATUS,
  } from './providers';

  interface Account {
    provider: Provider;
    displayName: string;
    syncStatus: SyncStatus;
    syncError: string | null;
    lastSyncedAt: Date | string | null;
    liveCheckedAt?: Date | string | null;
    frameUrl: string | null;
    frameMotionUrl: string | null;
    playtimeHidden: boolean;
  }

  let {
    accounts: accountList,
    providers,
    retro,
    psn,
  }: {
    accounts: Account[];
    providers: Record<Provider, boolean>;
    retro: { onlineId: string; code: string } | null;
    psn: { onlineId: string; code: string } | null;
  } = $props();

  /** Les réglages de confidentialité du joueur connecté à Steam : `my` mène à son propre profil. */
  const STEAM_PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';

  const submit = submitWithToast();
  const accounts = $derived(new Map(accountList.map((a) => [a.provider, a])));
  const hasPsnSlot = $derived(!accounts.has('PSN') && providers.PSN);
  const hasRetroSlot = $derived(!accounts.has('RETRO') && providers.RETRO);

  const errorOf = (provider: Provider) =>
    latestSyncError($syncState[provider], accounts.get(provider)?.syncError);

  /** Steam se suit en direct : son dernier passage compte autant que la tournée quotidienne. */
  const lastChecked = (account: {
    lastSyncedAt: Date | string | null;
    liveCheckedAt?: Date | string | null;
  }) => {
    const dates = [account.lastSyncedAt, account.liveCheckedAt].filter((date) => date != null);
    return dates.length
      ? new Date(Math.max(...dates.map((date) => new Date(date).getTime())))
      : null;
  };
</script>

<section class="space-y-3">
  <h2>{m.linked_accounts()}</h2>
  <ul class="card divide-y divide-line">
    {#each PROVIDERS.filter((item) => item !== 'BLIZZARD' || providers.BLIZZARD) as provider (provider)}
      {@const account = accounts.get(provider)}
      {@const live = $syncState[provider]}
      {@const status = live?.status ?? account?.syncStatus}
      {@const error = syncErrorText(errorOf(provider))}
      {@const available = providers[provider]}
      <li
        id={provider.toLowerCase()}
        class="scroll-mt-20 space-y-2 p-4 target:bg-raised"
        data-provider={provider}
      >
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-muted"><ProviderIcon {provider} size={20} /></span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{PROVIDER_LABELS[provider]}</p>
            <p class="truncate text-xs text-muted">
              {#if account}
                {account.displayName}
                {#if !LOGIN_ONLY.includes(provider) && status}· {STATUS[status]}{/if}
                {#if lastChecked(account) && status === 'COMPLETED'}
                  · {formatRelative(lastChecked(account)!)}
                {/if}
              {:else if provider === 'EPIC'}
                {m.provider_wip_text()}
              {:else if !available}
                {m.provider_disabled()}
              {:else}
                {DESCRIPTIONS[provider]}
              {/if}
            </p>
          </div>

          {#if account}
            {#if status === 'NEEDS_RELINK' && OAUTH[provider]}
              <a class="btn btn-primary" href="/auth/{OAUTH[provider]}/start" data-sveltekit-reload>
                {m.reconnect()}
              </a>
            {:else if provider === 'GOOGLE'}
              <!-- Google n'a pas d'accès de serveur : repasser par lui relit son image. -->
              <a
                class="btn"
                href="/auth/{OAUTH[provider]}/start?retour=/compte"
                data-sveltekit-reload
              >
                {m.synchronize()}
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
          {:else if provider === 'EPIC'}
            <span class="rounded-full bg-raised px-2.5 py-1 text-xs text-muted">
              {m.provider_wip()}
            </span>
          {:else if available && OAUTH[provider]}
            <a class="btn" href="/auth/{OAUTH[provider]}/start" data-sveltekit-reload>{m.link()}</a>
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

        <!-- Recalculé à la fin de chaque synchronisation : pendant qu'elle tourne, on ne sait plus. -->
        {#if provider === 'STEAM' && account?.playtimeHidden && status !== 'QUEUED' && status !== 'SYNCING'}
          <p class="text-xs text-muted" data-testid="steam-playtime-private">
            {m.steam_playtime_private()}
            <a
              href={STEAM_PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-ink"
            >
              {m.steam_playtime_private_link()}
            </a>
          </p>
        {/if}

        {#if account && PRIVACY[provider] && isClosedError(errorOf(provider))}
          <p class="text-xs text-muted">
            {PRIVACY[provider].hint()}
            <a
              href={PRIVACY[provider].url}
              target="_blank"
              rel="noopener noreferrer"
              class="underline text-danger"
            >
              {m.privacy_fix_link()}
            </a>
          </p>
        {/if}

        {#if provider === 'RETRO' && hasRetroSlot}
          {#if retro}
            <div class="space-y-2 rounded bg-raised p-3 text-sm">
              <p>
                {m.retro_instructions({ name: retro.onlineId })}
                <a
                  href="https://retroachievements.org/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline"
                >
                  {m.privacy_fix_link()}
                </a>
              </p>
              <p class="font-mono text-base font-semibold">{retro.code}</p>
              <p class="text-xs text-muted">{m.retro_hardcore_note()}</p>
              <div class="flex gap-2">
                <form method="POST" action="?/retroConfirm" use:enhance={submit}>
                  <button class="btn btn-primary">{m.verify()}</button>
                </form>
                <form method="POST" action="?/psnCancel" use:enhance={submit}>
                  <button class="btn btn-ghost">{m.cancel()}</button>
                </form>
              </div>
            </div>
          {:else}
            <form method="POST" action="?/retroStart" use:enhance={submit} class="flex gap-2">
              <input
                name="username"
                required
                aria-label={m.retro_id()}
                placeholder={m.retro_id()}
                autocomplete="off"
                class="input max-w-xs"
              />
              <button class="btn">{m.link()}</button>
            </form>
          {/if}
        {/if}

        {#if provider === 'PSN' && hasPsnSlot}
          {#if psn}
            <div class="space-y-2 rounded bg-raised p-3 text-sm">
              <p>
                {m.psn_instructions({ name: psn.onlineId })}
              </p>
              <p class="font-mono text-base font-semibold">{psn.code}</p>
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
