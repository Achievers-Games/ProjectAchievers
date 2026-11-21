<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import Avatar from '#lib/components/Avatar.svelte';
  import ProfileCardArt from '#lib/components/ProfileCardArt.svelte';
  import { cssArt } from '#lib/art';
  import { m } from '#lib/paraglide/messages';
  import { getLocale } from '#lib/paraglide/runtime';
  import { toast } from '#lib/stores/toast';
  import type { EditionKind } from '#prisma';

  let {
    card,
    person,
    equipped,
  }: {
    card: {
      editionId: string;
      kind: EditionKind;
      assetPath?: string | null;
      game: { headerUrl: string | null } | null;
      bannerCompletion: number | null;
    };
    person: Pick<
      NonNullable<App.Locals['user']>,
      'displayName' | 'avatarUrl' | 'avatarMotionUrl' | 'frame' | 'frameMotionUrl'
    >;
    equipped: boolean;
  } = $props();

  let dialog: HTMLDialogElement;
  let pending = $state(false);
  let failure = $state('');
  let mobile = $state(false);
  let previewing = $state(false);
  const progress = $derived(
    new Intl.NumberFormat(getLocale(), { style: 'percent' }).format(
      Math.floor(card.bannerCompletion ?? 0) / 100,
    ),
  );

  onMount(() => () => dialog?.close());
</script>

{#if card.bannerCompletion === 100}
  {#if equipped}
    <p class="text-sm text-muted">{m.collection_banner_equipped()}</p>
  {:else}
    <button
      type="button"
      class="btn"
      onclick={async () => {
        failure = '';
        mobile = false;
        previewing = true;
        await tick();
        if (dialog?.isConnected && !dialog.open) dialog.showModal();
      }}>{m.collection_banner_equip()}</button
    >
  {/if}
{:else}
  <p class="text-sm text-muted">
    {card.bannerCompletion === null
      ? m.collection_banner_ineligible()
      : m.collection_banner_progress({ progress })}
  </p>
{/if}

<dialog
  bind:this={dialog}
  class="preview card"
  aria-label={m.collection_banner_preview()}
  onclose={() => (previewing = false)}
>
  {#if previewing}
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2>{m.collection_banner_preview()}</h2>
      <button type="button" class="btn" aria-pressed={mobile} onclick={() => (mobile = !mobile)}>
        {m.collection_banner_mobile()}
      </button>
    </header>
    <div class="preview-frame" class:mobile>
      <div
        class="profile-banner isolate"
        data-art
        data-card-banner
        style:--art={card.game?.headerUrl ? cssArt([card.game.headerUrl]) : undefined}
      >
        {#if card.assetPath}
          {#key card.editionId}
            <ProfileCardArt assetPath={card.assetPath} kind={card.kind} />
          {/key}
        {/if}
        <Avatar {person} play="always" size={112} />
        <h1>{person.displayName}</h1>
      </div>
    </div>
    {#if failure}<p role="alert">{failure}</p>{/if}
    <div class="flex flex-wrap justify-end gap-2">
      <button type="button" class="btn" onclick={() => dialog.close()}>{m.reveal_close()}</button>
      <form
        method="POST"
        action="/boosters/collection?/banner"
        use:enhance={() => {
          pending = true;
          failure = '';
          return async ({ result }) => {
            pending = false;
            if (result.type === 'success') {
              dialog.close();
              toast(m.collection_banner_equipped());
              await invalidateAll();
            } else {
              failure = String(
                result.type === 'failure'
                  ? (result.data?.error ?? m.action_failed())
                  : m.action_failed(),
              );
            }
          };
        }}
      >
        <button class="btn btn-primary" name="editionId" value={card.editionId} disabled={pending}>
          {m.collection_banner_equip()}
        </button>
      </form>
    </div>
  {/if}
</dialog>

<style>
  .preview {
    margin: auto;
    width: min(920px, calc(100vw - 1.5rem));
    max-height: calc(100dvh - 1.5rem);
    overflow: auto;
    padding: 1rem;
    color: rgb(var(--ink));
  }
  .preview[open] {
    display: grid;
    gap: 1rem;
  }
  .preview::backdrop {
    background: rgb(0 0 0 / 0.7);
  }
  .preview-frame {
    width: 100%;
    margin-inline: auto;
  }
  .preview-frame.mobile {
    max-width: 343px;
  }
</style>
