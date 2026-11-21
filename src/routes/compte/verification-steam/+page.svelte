<script lang="ts">
  import Clock from '@lucide/svelte/icons/clock';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import ShieldX from '@lucide/svelte/icons/shield-x';
  import { m } from '#lib/paraglide/messages';
  import { formatDate } from '#lib/labels';

  let { data } = $props();

  /** La plus grave d'abord, comme dans la fenêtre qui prévient le joueur. */
  const GROUPS = [
    {
      state: 'blocked',
      icon: ShieldX,
      title: m.steam_status_blocked,
      detail: m.steam_check_blocked_detail,
      tone: 'text-danger',
    },
    {
      state: 'pending',
      icon: Clock,
      title: m.steam_status_pending,
      detail: m.steam_check_pending_detail,
      tone: 'text-gold',
    },
    {
      state: 'unblocked',
      icon: ShieldCheck,
      title: m.steam_check_unblocked_title,
      detail: m.steam_check_unblocked_detail,
      tone: 'text-success',
    },
  ] as const;
  const groups = $derived(
    GROUPS.map((group) => ({
      ...group,
      games: data.games.filter((game) => game.state === group.state),
    })).filter((group) => group.games.length),
  );
</script>

<svelte:head>
  <title>{m.steam_check_title()} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <div class="space-y-1">
    <h1>{m.steam_check_title()}</h1>
    <p class="text-sm text-muted">{m.steam_check_intro()}</p>
  </div>

  {#if !groups.length}
    <p class="card px-4 py-6 text-center text-sm text-muted">{m.steam_check_empty()}</p>
  {/if}

  {#each groups as group (group.state)}
    <section class="space-y-2" data-testid="steam-check-{group.state}">
      <h2 class="flex items-center gap-2 text-base font-semibold">
        <group.icon size={18} class={group.tone} aria-hidden="true" />
        {group.title()}
        <span class="text-sm font-normal text-muted">({group.games.length})</span>
      </h2>
      <p class="text-sm text-muted">{group.detail()}</p>
      <ul class="card divide-y divide-line">
        {#each group.games as item (item.id)}
          <li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div class="min-w-0">
              <a class="font-medium hover:underline" href="/jeux/{item.game.slug}"
                >{item.game.name}</a
              >
              <p class="text-xs text-muted">
                {m.steam_check_since({ date: formatDate(item.since) })}
                {#if item.proofAt}· {m.steam_check_proof_sent({
                    date: formatDate(item.proofAt),
                  })}{/if}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              {#if item.canProve}
                <a
                  class="btn btn-primary h-8"
                  href="/jeux/{item.game.slug}?succes=hors-score#preuve"
                  >{m.steam_check_send_proof()}</a
                >
              {/if}
              {#if item.canReset}
                <a class="btn h-8" href="/jeux/{item.game.slug}?succes=hors-score#remise-a-zero"
                  >{m.steam_check_reset()}</a
                >
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
