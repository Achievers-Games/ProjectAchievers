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
</script>

<svelte:head>
  <title>{m.moderation()} — Project Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
  <h1>{m.moderation()}</h1>

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
    <p class="text-sm text-muted">
      {m.mod_groups_text()}
    </p>

    <form method="POST" action="?/join" use:enhance class="card flex flex-wrap gap-2 p-3">
      <input
        name="first"
        required
        aria-label={m.mod_first()}
        placeholder={m.mod_first_placeholder()}
        class="input max-w-xs"
      />
      <input
        name="second"
        required
        aria-label={m.mod_second()}
        placeholder={m.mod_second_placeholder()}
        class="input max-w-xs"
      />
      <button class="btn">{m.mod_join()}</button>
    </form>

    <ul class="card divide-y divide-line">
      {#each data.families as family (family.key)}
        <li class="space-y-1 p-3">
          {#each family.games as game (game.id)}
            <div class="flex items-center justify-between gap-2 text-sm">
              <a href="/jeux/{game.slug}" class="min-w-0 truncate">
                {game.name} · {PLATFORM_LABELS[game.platform]}
              </a>
              <form method="POST" action="?/separate" use:enhance>
                <input type="hidden" name="id" value={game.id} />
                <button class="btn btn-ghost h-7">{m.mod_separate()}</button>
              </form>
            </div>
          {/each}
        </li>
      {/each}
    </ul>
  </section>
</div>
