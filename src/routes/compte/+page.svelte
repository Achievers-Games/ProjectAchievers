<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import PushSettings from '$lib/components/PushSettings.svelte';
  import DangerZone from '$lib/components/compte/DangerZone.svelte';
  import FramePicker from '$lib/components/compte/FramePicker.svelte';
  import LinkedAccounts from '$lib/components/compte/LinkedAccounts.svelte';
  import Preferences from '$lib/components/compte/Preferences.svelte';
  import ProfileForm from '$lib/components/compte/ProfileForm.svelte';
  import SessionList from '$lib/components/compte/SessionList.svelte';
  import { isClosedError, PRIVACY } from '$lib/components/compte/providers';
  import { PROVIDER_LABELS } from '$lib/labels';
  import { syncState } from '$lib/stores/sync';
  import { submitWithToast } from '$lib/forms';

  let { data } = $props();

  const submit = submitWithToast();
  const avatars = $derived([
    ...new Map(
      data.accounts
        .filter((a) => a.avatarUrl)
        .map((a) => [
          a.avatarUrl,
          { label: PROVIDER_LABELS[a.provider], motion: a.avatarMotionUrl },
        ]),
    ),
  ] as [string, { label: string; motion: string | null }][]);

  /** Les plateformes qui nous ferment la porte, avec le réglage à changer chez elles. */
  const toOpen = $derived(
    data.accounts.flatMap((account) => {
      const privacy = PRIVACY[account.provider];
      const error = $syncState[account.provider]?.error ?? account.syncError;
      return privacy && isClosedError(error) ? [{ ...privacy, provider: account.provider }] : [];
    }),
  );
</script>

<svelte:head><title>{m.my_account()} — Project Achievers</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-8">
  <h1>{m.my_account()}</h1>

  {#if data.welcome}
    <div class="card space-y-2 px-3 py-2 text-sm">
      <p>{m.account_welcome()}</p>
      {#if toOpen.length}
        <p class="font-medium">{m.privacy_fix_title()}</p>
        <ul class="space-y-1">
          {#each toOpen as item (item.provider)}
            <li>
              <a href={item.url} target="_blank" rel="noopener noreferrer" class="underline">
                {PROVIDER_LABELS[item.provider]}
              </a>
              : {item.hint()}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
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
          <form method="POST" action="?/merge" use:enhance={submit} class="space-y-2">
            {#if data.merge.clans}
              <fieldset class="space-y-1">
                <legend class="text-sm">{m.merge_clan_choice()}</legend>
                <label class="flex items-center gap-2 text-sm">
                  <input type="radio" name="clan" value="target" required />
                  {data.merge.clans.target}
                </label>
                <label class="flex items-center gap-2 text-sm">
                  <input type="radio" name="clan" value="source" required />
                  {data.merge.clans.source}
                </label>
              </fieldset>
            {/if}
            <button class="btn btn-primary">{m.merge_action()}</button>
          </form>
        {/if}
        <form method="POST" action="?/mergeCancel" use:enhance={submit}>
          <button class="btn btn-ghost">{m.cancel()}</button>
        </form>
      </div>
    </section>
  {/if}

  <ProfileForm profile={data.profile} {avatars} />

  <FramePicker profile={data.profile} accounts={data.accounts} frames={data.frames} />

  <LinkedAccounts
    accounts={data.accounts}
    providers={data.providers}
    retro={data.retro}
    psn={data.psn}
  />

  <PushSettings publicKey={data.pushKey} profile={data.profile} />

  <Preferences profile={data.profile} theme={data.theme} />

  <SessionList sessions={data.sessions} />

  <DangerZone handle={data.user?.handle ?? ''} />
</div>
