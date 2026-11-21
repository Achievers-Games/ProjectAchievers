<script lang="ts">
  import Clock from '@lucide/svelte/icons/clock';
  import FileCheck from '@lucide/svelte/icons/file-check';
  import ShieldX from '@lucide/svelte/icons/shield-x';
  import { enhance } from '$app/forms';
  import { m } from '#lib/paraglide/messages';
  import { formatDate, formatRelative, PLATFORM_LABELS } from '#lib/labels';
  import type { PageData } from './$types';

  type Review = PageData['steamReviews'][number];
  type TrustSignal = NonNullable<Review['trust']>['signals'][number];

  let { review }: { review: Review } = $props();

  const hours = (minutes: number) => `${Math.round(minutes / 6) / 10} h`;
  const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

  /** Un signal du score de confiance Steam, en mots. */
  function trustLabel(signal: TrustSignal) {
    switch (signal.kind) {
      case 'playtime_peers':
        return m.steam_trust_playtime_peers({
          time: hours(signal.minutes),
          median: hours(signal.median),
          peers: String(signal.peers),
        });
      case 'playtime_rate':
        return m.steam_trust_playtime_rate({
          time: hours(signal.minutes),
          rate: String(signal.perAchievement),
        });
      case 'playtime_unknown':
        return m.steam_trust_playtime_unknown();
      case 'offline':
        return m.steam_trust_offline({ time: hours(signal.minutes) });
      case 'history':
        return m.steam_trust_history({ count: String(signal.count) });
      case 'near_impossible':
        return m.steam_trust_near_impossible({ count: String(signal.count) });
      case 'large_batch':
        return m.steam_trust_large_batch({ count: String(signal.count) });
      case 'cross_progress':
        return m.steam_trust_cross_progress();
      case 'pace':
        return m.steam_trust_pace();
      case 'playtime_reference':
        return m.steam_trust_playtime_reference({
          time: hours(signal.minutes),
          expected: hours(signal.expected),
        });
      case 'other_platform':
        return m.steam_trust_other_platform({
          platform:
            PLATFORM_LABELS[signal.platform as keyof typeof PLATFORM_LABELS] ?? signal.platform,
          completion: String(Math.round(signal.completion)),
          time: hours(signal.minutes),
        });
    }
  }

  const pending = $derived(review.status === 'PENDING');
  const status = $derived(
    review.status === 'REJECTED'
      ? {
          label: m.steam_mod_status_rejected(),
          tone: 'text-danger border-danger/50',
          icon: ShieldX,
        }
      : review.suspended
        ? {
            label: m.steam_mod_status_suspended(),
            tone: 'text-danger border-danger/50',
            icon: ShieldX,
          }
        : { label: m.steam_mod_status_pending(), tone: 'text-gold border-gold/50', icon: Clock },
  );
  const pace = $derived(review.trust?.signals.some((signal) => signal.kind === 'pace'));
  const offlineKnown = $derived(review.trust?.signals.some((signal) => signal.kind === 'offline'));
  /** Les succès retenus, regroupés par seconde de déblocage. */
  const batches = $derived(
    [
      ...Map.groupBy(
        review.unlocks.filter((unlock) => unlock.held),
        (unlock) => unlock.at.getTime(),
      ).entries(),
    ]
      .map(([at, unlocks]) => ({ at: new Date(at), count: unlocks.length }))
      .sort((a, b) => b.count - a.count || a.at.getTime() - b.at.getTime()),
  );
  const stamp = (date: Date) => `${formatDate(date)} ${date.toISOString().slice(11, 19)} UTC`;

  let form = $state<HTMLFormElement>();
  function pickAll(checked: boolean) {
    for (const box of form?.querySelectorAll<HTMLInputElement>('input[name="accepted"]') ?? []) {
      if (!box.disabled) box.checked = checked;
    }
  }
  function confirmBlock(event: MouseEvent) {
    const message = m.steam_mod_block_confirm({
      game: review.game.name,
      player: review.player?.displayName ?? m.steam_review_deleted_player(),
    });
    if (!confirm(message)) event.preventDefault();
  }
  function confirmCrossProgress(event: MouseEvent) {
    if (!confirm(m.steam_mod_cross_confirm())) event.preventDefault();
  }
</script>

<article
  class="space-y-3 rounded-lg border border-line bg-surface p-4 text-sm"
  id={`steam-review-${review.id}`}
  data-testid="steam-review"
>
  <header class="flex flex-wrap items-start justify-between gap-2">
    <div class="min-w-0 space-y-0.5">
      <p class="text-base font-semibold">
        <a class="hover:underline" href="/jeux/{review.game.slug}">{review.game.name}</a>
      </p>
      <p class="text-muted">
        {#if review.player}
          <a class="hover:underline" href="/u/{review.player.handle}">{review.player.displayName}</a
          >
        {:else}
          {m.steam_review_deleted_player()}
        {/if}
        · {m.steam_mod_opened({ when: formatRelative(review.openedAt) })}
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      {#if review.proofs.length}
        <span
          class="inline-flex items-center gap-1 rounded-full border border-accent/60 px-2 py-0.5 text-xs text-accent"
        >
          <FileCheck size={13} aria-hidden="true" />
          {m.steam_mod_proof_badge()}
        </span>
      {/if}
      <span
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs {status.tone}"
      >
        <status.icon size={13} aria-hidden="true" />
        {status.label}
      </span>
    </div>
  </header>

  <div class="grid gap-3 sm:grid-cols-2">
    <div class="space-y-1.5">
      <p class="font-medium">{m.steam_mod_batches_title()}</p>
      {#if pace}
        <p class="text-muted">{m.steam_mod_reason_pace()}</p>
      {/if}
      <ul class="space-y-0.5 text-muted">
        {#each batches.slice(0, 4) as batch (batch.at.getTime())}
          <li>{m.steam_mod_batch({ count: String(batch.count), date: stamp(batch.at) })}</li>
        {/each}
        {#if batches.length > 4}
          <li>{m.steam_mod_batches_more({ count: String(batches.length - 4) })}</li>
        {/if}
      </ul>
      {#if review.game.totalAchievements}
        <p class="text-xs text-muted">
          {m.steam_mod_flagged_of({
            count: String(review.unlocks.length),
            total: String(review.game.totalAchievements),
          })}
        </p>
      {/if}
      {#if review.relatedGames}
        <p class="text-muted">
          {m.steam_mod_related_cases({ count: String(review.relatedGames) })}
        </p>
      {/if}
      {#if pending && !review.suspended}
        <p class="font-medium">
          {review.heldCount
            ? m.steam_mod_effect_held({ count: String(review.heldCount) })
            : m.steam_mod_effect_preserved()}
        </p>
      {/if}
    </div>
    <div class="space-y-1.5">
      <p class="flex flex-wrap items-center gap-2 font-medium">
        {#if review.trust}
          {m.steam_trust_score({ score: signed(review.trust.score) })}
        {:else}
          <span class="text-muted">{m.steam_trust_none()}</span>
        {/if}
      </p>
      {#if review.trust}
        {#if !offlineKnown}
          <p class="text-xs text-muted">{m.steam_mod_offline_unverified()}</p>
        {/if}
        <ul class="space-y-0.5">
          {#each review.trust.signals as signal (signal.kind)}
            <li class="flex gap-2">
              <span
                class="w-7 shrink-0 text-right font-mono text-xs leading-5 {signal.weight > 0
                  ? 'text-success'
                  : signal.weight < 0
                    ? 'text-danger'
                    : 'text-muted'}">{signal.weight ? signed(signal.weight) : '·'}</span
              >
              <span class="text-muted">{trustLabel(signal)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  {#if review.proofs.length}
    <div class="space-y-2 rounded-md border border-accent/40 p-3">
      <p class="font-medium">{m.steam_proof_mod_title()}</p>
      {#each review.proofs as proof (proof.id)}
        <div class="flex flex-wrap gap-3">
          {#if proof.image}
            <a href={proof.image} target="_blank" rel="noopener" class="shrink-0">
              <img
                src={proof.image}
                alt={m.steam_proof_mod_image()}
                class="max-h-40 rounded border border-line"
                loading="lazy"
              />
            </a>
          {/if}
          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-xs text-muted">{formatRelative(proof.createdAt)}</p>
            {#if proof.message}<p class="whitespace-pre-line">{proof.message}</p>{/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <form bind:this={form} method="POST" action="?/steamReview" use:enhance class="space-y-3">
    <input type="hidden" name="id" value={review.id} />
    <input type="hidden" name="version" value={review.openedAt.getTime()} />

    <div class="flex flex-wrap items-center gap-2">
      <button class="btn btn-primary" name="decision" value="approve">
        {pending ? m.steam_review_validate_all() : m.steam_mod_unblock()}
      </button>
      {#if pending}
        <button class="btn btn-danger" name="decision" value="suspend" onclick={confirmBlock}>
          {m.steam_mod_block()}
        </button>
      {/if}
      <label class="flex items-center gap-2 text-muted">
        {#if !review.game.allowSteamBatches}
          <input type="checkbox" name="allowBatches" value="1" />
          {m.steam_review_exception()}
        {/if}
      </label>
    </div>
    {#if !pending || review.heldCount || review.suspended}
      <p class="text-xs text-muted">{pending ? m.steam_mod_help() : m.steam_mod_help_blocked()}</p>
    {/if}

    {#if pending}
      <details class="rounded-md border border-line p-3">
        <summary class="cursor-pointer font-medium">
          {m.steam_mod_pick({ count: String(review.unlocks.length) })}
        </summary>
        <div class="mt-2 space-y-2">
          <p class="text-muted">{m.steam_review_selection()}</p>
          <div class="flex gap-2">
            <button type="button" class="btn h-7 text-xs" onclick={() => pickAll(true)}
              >{m.steam_mod_pick_all()}</button
            >
            <button type="button" class="btn h-7 text-xs" onclick={() => pickAll(false)}
              >{m.steam_mod_pick_none()}</button
            >
          </div>
          <ul class="max-h-72 space-y-1 overflow-y-auto pr-1">
            {#each review.unlocks as unlock (unlock.key)}
              <li>
                <label class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="accepted"
                    value={unlock.key}
                    disabled={!unlock.available}
                  />
                  <span>
                    {unlock.name}
                    <span class="text-xs text-muted">· {stamp(unlock.at)}</span>
                    {#if !unlock.held && !review.suspended}
                      <span class="text-xs text-muted">· {m.steam_mod_unlock_counted()}</span>
                    {/if}
                  </span>
                </label>
              </li>
            {/each}
          </ul>
          <button class="btn btn-secondary" name="decision" value="selected">
            {m.steam_review_validate_selection()}
          </button>
        </div>
      </details>
    {/if}
  </form>

  {#if !review.game.crossProgress}
    <form method="POST" action="?/crossProgress" use:enhance class="border-t border-line pt-2">
      <input type="hidden" name="id" value={review.game.id} />
      <input type="hidden" name="value" value="1" />
      <button class="text-xs text-muted underline hover:text-ink" onclick={confirmCrossProgress}
        >{m.steam_mod_cross_mark()}</button
      >
    </form>
  {/if}
</article>
