<script lang="ts">
  import {
    FEEDBACK_STATUSES,
    feedbackAreaLabel,
    feedbackKindLabel,
    feedbackStatusLabel,
  } from '#lib/feedback';
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import Empty from '#lib/components/Empty.svelte';
  import { formatDate, formatRelative, PLATFORM_LABELS } from '#lib/labels';

  let { data, form } = $props();

  /** La raison d'un échec de connexion, en mots. */
  const AUTH_REASONS: Record<string, () => string> = {
    expire: m.mod_signups_reason_expire,
    annule: m.mod_signups_reason_cancelled,
    fournisseur: m.mod_signups_reason_provider,
    refuse: m.mod_signups_reason_refused,
    deja_lie: m.mod_signups_reason_taken,
  };
  const authReason = (reason: string) => AUTH_REASONS[reason]?.() ?? reason;

  type TrustSignal = NonNullable<(typeof data.steamReviews)[number]['trust']>['signals'][number];
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
</script>

<svelte:head>
  <title>{m.moderation()} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
  <h1>{m.moderation()}</h1>

  <section id="steam-reviews" class="card space-y-3 p-4">
    <h2 class="text-base">{m.steam_review_title()}</h2>
    {#if form?.error}<p class="text-sm text-danger" role="alert">{form.error}</p>{/if}
    {#if !data.steamReviews.length}
      <p class="text-sm text-muted">{m.steam_review_empty()}</p>
    {/if}
    {#each data.steamReviews as review (review.id)}
      <details class="rounded-md border border-line p-3" id={`steam-review-${review.id}`}>
        <summary class="cursor-pointer font-medium">
          {review.game.name} · {review.player?.displayName ?? m.steam_review_deleted_player()}
          <span class="text-sm text-muted">
            · {review.status === 'REJECTED'
              ? m.steam_review_rejected()
              : review.suspended
                ? m.steam_review_suspended()
                : m.steam_review_pending()}
          </span>
        </summary>
        <form method="POST" action="?/steamReview" use:enhance class="mt-3 space-y-3 text-sm">
          <input type="hidden" name="id" value={review.id} />
          <input type="hidden" name="version" value={review.openedAt.getTime()} />
          <div class="flex gap-3">
            <a class="underline" href="/jeux/{review.game.slug}">{review.game.name}</a>
            {#if review.player}
              <a class="underline" href="/u/{review.player.handle}">{review.player.displayName}</a>
            {/if}
          </div>
          {#if review.trust}
            <div>
              <p class="font-medium">
                {m.steam_trust_score({ score: signed(review.trust.score) })}
              </p>
              <ul class="list-disc pl-5 text-muted">
                {#each review.trust.signals as signal (signal.kind)}
                  <li>
                    {trustLabel(signal)}{#if signal.weight}
                      ({signed(signal.weight)}){/if}
                  </li>
                {/each}
              </ul>
            </div>
          {:else}
            <p class="text-muted">{m.steam_trust_none()}</p>
          {/if}
          {#if review.proofs.length}
            <div class="space-y-2">
              <p class="font-medium">{m.steam_proof_mod_title()}</p>
              {#each review.proofs as proof (proof.id)}
                <div class="space-y-1 rounded-md border border-line p-2">
                  <p class="text-xs text-muted">{formatRelative(proof.createdAt)}</p>
                  {#if proof.message}<p class="whitespace-pre-line">{proof.message}</p>{/if}
                  {#if proof.image}
                    <a href={proof.image} target="_blank" rel="noopener">
                      <img
                        src={proof.image}
                        alt={m.steam_proof_mod_image()}
                        class="max-h-64 rounded border border-line"
                        loading="lazy"
                      />
                    </a>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if review.status === 'PENDING'}
            <fieldset class="space-y-1">
              <legend class="font-medium">{m.steam_review_selection()}</legend>
              {#each review.unlocks as unlock (unlock.key)}
                <label class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="accepted"
                    value={unlock.key}
                    disabled={!unlock.available}
                  />
                  <span
                    >{unlock.name} · {unlock.at.toISOString().replace('T', ' ').slice(0, 19)} UTC</span
                  >
                </label>
              {/each}
            </fieldset>
          {/if}
          {#if !review.game.allowSteamBatches}
            <label class="flex items-center gap-2">
              <input type="checkbox" name="allowBatches" value="1" />
              {m.steam_review_exception()}
            </label>
          {/if}
          <div class="flex flex-wrap gap-2">
            {#if review.status === 'PENDING'}
              <button class="btn btn-secondary" name="decision" value="selected">
                {m.steam_review_validate_selection()}
              </button>
              <button class="btn btn-secondary" name="decision" value="suspend">
                {m.steam_review_suspend_game()}
              </button>
            {/if}
            <button class="btn btn-secondary" name="decision" value="approve">
              {m.steam_review_validate_all()}
            </button>
          </div>
        </form>
      </details>
    {/each}
    {#if data.importSuggestions.length || data.crossProgressGames.length}
      <div class="space-y-2 border-t border-line pt-3 text-sm">
        <h3 class="font-medium">{m.steam_cross_title()}</h3>
        <p class="text-muted">{m.steam_cross_detail()}</p>
        <ul class="space-y-1">
          {#each data.importSuggestions as game (game.id)}
            <li class="flex items-center justify-between gap-2">
              <a class="underline" href="/jeux/{game.slug}">{game.name}</a>
              <span class="flex items-center gap-2">
                <span class="text-muted"
                  >{m.steam_cross_players({ count: String(game.players) })}</span
                >
                <form method="POST" action="?/crossProgress" use:enhance>
                  <input type="hidden" name="id" value={game.id} />
                  <input type="hidden" name="value" value="1" />
                  <button class="btn btn-secondary">{m.steam_cross_mark()}</button>
                </form>
              </span>
            </li>
          {/each}
          {#each data.crossProgressGames as game (game.id)}
            <li class="flex items-center justify-between gap-2">
              <a class="underline" href="/jeux/{game.slug}">{game.name}</a>
              <form method="POST" action="?/crossProgress" use:enhance>
                <input type="hidden" name="id" value={game.id} />
                <input type="hidden" name="value" value="0" />
                <button class="btn btn-secondary">{m.steam_cross_unmark()}</button>
              </form>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>

  {#if data.signups}
    {@const stats = data.signups}
    <section class="card space-y-3 p-4 text-sm" data-testid="signups">
      <h2 class="text-base">{m.mod_signups()}</h2>
      <p>
        {m.mod_signups_members({ total: stats.members, week: stats.week, month: stats.month })}
      </p>
      <p class="text-muted">{m.mod_signups_help()}</p>
      <div class="overflow-x-auto">
        <table class="tabular w-full text-left text-xs">
          <thead class="text-muted">
            <tr>
              <th class="py-1 pr-3 font-medium">{m.mod_signups_day()}</th>
              <th class="py-1 pr-3 font-medium">{m.mod_signups_starts()}</th>
              <th class="py-1 pr-3 font-medium">{m.mod_signups_new()}</th>
              <th class="py-1 pr-3 font-medium">{m.mod_signups_logins()}</th>
              <th class="py-1 font-medium">{m.mod_signups_errors()}</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.days as row (row.day)}
              <tr class="border-t border-line">
                <td class="py-1 pr-3">{formatDate(new Date(row.day))}</td>
                <td class="py-1 pr-3">{row.starts}</td>
                <td class="py-1 pr-3 {row.signups ? 'font-semibold text-ink' : ''}"
                  >{row.signups}</td
                >
                <td class="py-1 pr-3">{row.logins}</td>
                <td class="py-1 {row.errors ? 'text-danger' : ''}">{row.errors}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if stats.providers.length}
        <p>
          <span class="text-muted">{m.mod_signups_providers()}</span>
          {#each stats.providers as row, i (row.provider)}
            {i ? ' · ' : ''}{row.provider} : {row.starts} → {row.signups + row.logins}
          {/each}
        </p>
      {/if}
      {#if stats.reasons.length}
        <p>
          <span class="text-muted">{m.mod_signups_reasons()}</span>
          {#each stats.reasons as row, i (row.reason)}
            {i ? ' · ' : ''}{authReason(row.reason)} : {row.count}
          {/each}
        </p>
      {/if}
    </section>
  {/if}

  {#if data.psnToken !== undefined}
    {@const token = data.psnToken}
    <section
      class="card space-y-1 p-4 text-sm {token?.warn ? 'border-danger' : ''}"
      data-testid="psn-token"
    >
      <h2 class="text-base">{m.mod_psn_token()}</h2>
      {#if !token}
        <p class="text-muted">{m.mod_psn_token_unknown()}</p>
      {:else if token.failing}
        <p class="text-danger">{m.mod_psn_token_failing()}</p>
      {:else}
        <p class={token.warn ? 'text-danger' : 'text-muted'}>
          {m.mod_psn_token_ok({
            since: formatDate(token.since),
            until: formatDate(token.expiresAt),
            days: token.daysLeft,
          })}
        </p>
      {/if}
      <p class="text-muted">{m.mod_psn_token_help()}</p>
      <form method="POST" action="?/psnToken" use:enhance class="flex flex-wrap gap-2 pt-2">
        <label class="sr-only" for="npsso">{m.mod_psn_token_field()}</label>
        <input
          id="npsso"
          name="npsso"
          type="password"
          autocomplete="off"
          spellcheck="false"
          class="input h-9 min-w-0 flex-1"
          placeholder={m.mod_psn_token_field()}
          required
        />
        <button class="btn h-9">{m.mod_psn_token_save()}</button>
      </form>
      {#if form?.psn && form.error}
        <p class="text-danger" role="alert">{form.error}</p>
      {:else if form?.psn && form.success}
        <p class="text-muted" role="status">{form.success}</p>
      {/if}
    </section>
  {/if}

  {#if data.partners}
    <section class="card space-y-3 p-4 text-sm" data-testid="partners">
      <h2 class="text-base">{m.mod_partners()}</h2>
      <p class="text-muted">
        {m.mod_partners_help()}
        <a href="/api/v1/openapi.json" class="underline hover:text-ink">OpenAPI</a>
      </p>
      {#if form?.partnerKey}
        <div class="space-y-1 rounded border border-accent p-3">
          <p class="font-medium">{m.mod_partner_key_once({ name: form.partnerName })}</p>
          <code class="block select-all break-all">{form.partnerKey}</code>
        </div>
      {/if}
      {#if form?.oauthClient}
        <div class="space-y-1 rounded border border-accent p-3">
          <p class="font-medium">{m.mod_partner_oauth_once({ name: form.partnerName })}</p>
          <code class="block select-all break-all">client_id: {form.oauthClient.clientId}</code>
          <code class="block select-all break-all"
            >client_secret: {form.oauthClient.clientSecret}</code
          >
        </div>
      {/if}
      {#if form?.webhookSecret}
        <div class="space-y-1 rounded border border-accent p-3">
          <p class="font-medium">
            {m.mod_partner_webhook_secret_once({ name: form.partnerName })}
          </p>
          <code class="block select-all break-all">{form.webhookSecret}</code>
        </div>
      {/if}
      {#if data.partners.length}
        <ul class="divide-y divide-line">
          {#each data.partners as partner (partner.id)}
            <li class="flex flex-wrap items-center gap-3 py-2">
              <span class="font-medium">{partner.name}</span>
              <code class="text-muted">{partner.keyPrefix}…</code>
              <span class="text-muted">
                {partner.revokedAt
                  ? m.mod_partner_revoked()
                  : partner.lastUsedAt
                    ? m.mod_partner_last_used({ when: formatRelative(partner.lastUsedAt) })
                    : m.mod_partner_never_used()}
              </span>
              <span class="ml-auto flex gap-2">
                <form method="POST" action="?/partnerKey" use:enhance>
                  <input type="hidden" name="name" value={partner.name} />
                  <button class="btn">{m.mod_partner_renew()}</button>
                </form>
                {#if !partner.revokedAt}
                  <form method="POST" action="?/partnerRevoke" use:enhance>
                    <input type="hidden" name="id" value={partner.id} />
                    <button class="btn btn-danger">{m.mod_partner_revoke()}</button>
                  </form>
                {/if}
              </span>
              <form
                method="POST"
                action="?/partnerWebhook"
                use:enhance
                class="flex w-full flex-wrap items-center gap-2"
              >
                <input type="hidden" name="id" value={partner.id} />
                <input
                  name="slug"
                  class="input w-28"
                  value={partner.slug ?? ''}
                  placeholder="lure"
                  aria-label={m.mod_partner_slug()}
                  title={m.mod_partner_slug()}
                />
                <input
                  name="url"
                  type="url"
                  class="input min-w-0 flex-1"
                  value={partner.webhookUrl ?? ''}
                  placeholder="https://…"
                  aria-label={m.mod_partner_webhook_url()}
                  title={m.mod_partner_webhook_url()}
                />
                <button class="btn">{m.mod_partner_webhook_save()}</button>
                {#if partner.hasWebhookSecret}
                  <button class="btn" formaction="?/partnerWebhookSecret">
                    {m.mod_partner_webhook_new_secret()}
                  </button>
                {/if}
              </form>
              <form
                method="POST"
                action="?/partnerOAuth"
                use:enhance
                class="flex w-full flex-wrap items-start gap-2"
              >
                <input type="hidden" name="id" value={partner.id} />
                <textarea
                  name="uris"
                  rows="2"
                  class="input min-w-0 flex-1"
                  placeholder="https://lureverse.fr/auth/achievers/callback"
                  aria-label={m.mod_partner_oauth_uris()}
                  title={m.mod_partner_oauth_uris()}
                  value={partner.oauthRedirectUris.join('\n')}></textarea>
                <button class="btn">{m.mod_partner_oauth_save()}</button>
                {#if partner.oauthClientId}
                  <button class="btn" formaction="?/partnerOAuthSecret">
                    {m.mod_partner_oauth_new_secret()}
                  </button>
                {/if}
              </form>
              {#if partner.oauthClientId}
                <p class="w-full text-xs text-muted">
                  {m.mod_partner_oauth_client()} <code>{partner.oauthClientId}</code>
                </p>
              {/if}
              {#if partner.webhookUrl}
                <p class="w-full text-xs {partner.webhookFailures ? 'text-danger' : 'text-muted'}">
                  {partner.webhookFailures
                    ? m.mod_partner_webhook_failing({
                        count: partner.webhookFailures,
                        error: partner.webhookLastError ?? '',
                      })
                    : partner.webhookLastAttemptAt
                      ? m.mod_partner_webhook_ok({
                          when: formatRelative(partner.webhookLastAttemptAt),
                        })
                      : m.mod_partner_webhook_waiting()}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <form method="POST" action="?/partnerKey" use:enhance class="flex gap-2">
        <input
          name="name"
          class="input flex-1"
          required
          minlength="2"
          maxlength="40"
          placeholder="Lure"
          aria-label={m.mod_partner_name()}
        />
        <button class="btn btn-primary">{m.mod_partner_create()}</button>
      </form>
    </section>
  {/if}

  {#if data.emblems.length}
    <section class="space-y-2" data-testid="mod-emblems">
      <h2 class="text-base">{m.mod_emblems()}</h2>
      <ul class="card divide-y divide-line">
        {#each data.emblems as clan (clan.id)}
          <li class="flex flex-wrap items-center gap-3 p-3">
            <img src={clan.url} alt="" class="h-16 w-16 rounded-full object-cover" />
            <a href="/clans/{clan.slug}" class="min-w-0 flex-1 truncate">{clan.name}</a>
            <form method="POST" action="?/emblem" use:enhance class="flex gap-2">
              <input type="hidden" name="id" value={clan.id} />
              <button class="btn" name="keep" value="1">{m.mod_emblem_keep()}</button>
              <button class="btn btn-danger" name="keep" value="0">{m.mod_emblem_remove()}</button>
            </form>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#each data.reports as report (report.id)}
    <article class="card space-y-2 p-4">
      <p class="text-xs text-muted">
        {report.targetType === 'GUIDE'
          ? m.mod_reported_guide({ user: report.reporter })
          : report.targetType === 'MESSAGE'
            ? m.mod_reported_message({ user: report.reporter })
            : m.mod_reported_comment({ user: report.reporter })}
        · {formatRelative(report.createdAt)}
      </p>
      <p class="text-sm font-medium">{report.reason}</p>
      {#if report.target}
        <blockquote
          class="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-raised p-3 text-sm"
        >
          {report.target.contentMd || m.mod_content_deleted()}
        </blockquote>
        {#if report.target.href}
          <a class="text-xs text-muted underline" href={report.target.href}>
            {m.mod_context()}
          </a>
        {/if}
      {/if}
      <form method="POST" action="?/resolve" use:enhance class="flex gap-2">
        <input type="hidden" name="id" value={report.id} />
        <button name="hide" value="1" class="btn btn-danger">{m.mod_hide()}</button>
        <button class="btn">{m.mod_reject()}</button>
      </form>
    </article>
  {:else}
    <Empty title={m.mod_empty()} />
  {/each}

  <section class="space-y-3 pt-4">
    <h2>{m.feedback_title()}</h2>
    {#each data.feedback as item (item.id)}
      <article class="card space-y-2 p-4">
        <p class="text-xs text-muted">
          {feedbackKindLabel(item.kind)} · {feedbackAreaLabel(item.area)} ·
          <a href="/u/{item.user.handle}" class="underline">{item.user.displayName}</a>
          · {formatRelative(item.createdAt)}
        </p>
        <p class="whitespace-pre-wrap break-words text-sm">{item.content}</p>
        {#if item.userAgent}<p class="break-all text-xs text-muted">{item.userAgent}</p>{/if}
        <form method="POST" action="?/feedback" use:enhance>
          <input type="hidden" name="id" value={item.id} />
          <select
            name="status"
            class="input w-auto"
            aria-label={m.feedback_status()}
            value={item.status}
            onchange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {#each FEEDBACK_STATUSES as status (status)}
              <option value={status}>{feedbackStatusLabel(status)}</option>
            {/each}
          </select>
        </form>
      </article>
    {:else}
      <Empty title={m.feedback_empty()} />
    {/each}
  </section>

  <section class="space-y-3 pt-4">
    <h2>{m.mod_groups()}</h2>
    <p class="text-sm text-muted">{m.mod_groups_text()}</p>
    <a href="/moderation/familles" class="btn">{m.mod_groups_open()}</a>
  </section>

  <section class="space-y-3 pt-4">
    <h2>{m.mod_cards()}</h2>
    <p class="text-sm text-muted">{m.mod_cards_intro()}</p>
    <a href="/moderation/cartes" class="btn">{m.mod_cards_open()}</a>
  </section>

  <section class="space-y-3 pt-4">
    <h2>{m.mod_boosters()}</h2>
    <p class="text-sm text-muted">{m.mod_boosters_intro()}</p>
    <a href="/moderation/boosters" class="btn">{m.mod_boosters_open()}</a>
  </section>
</div>
