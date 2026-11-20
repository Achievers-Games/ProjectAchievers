<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import Bell from '@lucide/svelte/icons/bell';
  import Layers from '@lucide/svelte/icons/layers';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import Shield from '@lucide/svelte/icons/shield';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Trophy from '@lucide/svelte/icons/trophy';
  import UserPlus from '@lucide/svelte/icons/user-plus';
  import type { Component } from 'svelte';
  import { displayText } from '#lib/profanity';
  import { formatRelative } from '#lib/labels';
  import type { Notice, NoticeKind } from '#lib/notices';

  let { count = 0 }: { count?: number } = $props();

  const KIND_ICONS: Record<NoticeKind, Component<{ size?: number }>> = {
    message: MessageCircle,
    invite_friend: UserPlus,
    invite_clan: Shield,
    clan_request: Shield,
    clan_rename: TriangleAlert,
    integrity: TriangleAlert,
    unlock: Trophy,
    card: Layers,
  };

  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();
  let items = $state<Notice[]>([]);
  let loading = $state(false);
  let marking = $state(false);

  /** Au-delà de neuf, le compte exact ne change plus rien à l'écran. */
  const shown = $derived(count > 9 ? '9+' : String(count));
  const hasUnread = $derived(items.some((item) => item.unread));

  const kindLabel = (kind: NoticeKind) =>
    ({
      message: m.notification_message(),
      invite_friend: m.notification_invite_friend(),
      invite_clan: m.notification_invite_clan(),
      clan_request: m.notification_clan_request(),
      clan_rename: m.notification_clan_rename(),
      integrity: m.steam_review_title(),
      unlock: m.notification_unlock(),
      card: m.notification_card(),
    })[kind];

  const detail = (notice: Notice) =>
    notice.detail
      ? displayText(notice.detail, page.data.user?.allowProfanity, notice.detailLocale)
      : '';

  async function load() {
    loading = true;
    const response = await fetch('/api/notifications').catch(() => null);
    if (response?.ok) items = ((await response.json()) as { items: Notice[] }).items;
    loading = false;
  }

  function toggle() {
    open = !open;
    if (open) void load();
  }

  /** Échap ramène le focus sur la cloche ; un clic ailleurs laisse le curseur où l'utilisateur l'a mis. */
  function dismiss({ focus }: { focus: boolean }) {
    open = false;
    if (focus) button?.focus();
  }

  async function markAll() {
    marking = true;
    const response = await fetch('/api/notifications', { method: 'PUT' }).catch(() => null);
    marking = false;
    if (!response?.ok) return;
    items = items.map((item) => ({ ...item, unread: false }));
    // Le bouton se désactive : sans ce retour, le focus tomberait sur la page entière.
    panel?.focus();
    // Le badge se recalcule sur le serveur : messages, invitations et succès marqués lus.
    void invalidate('app:notices');
    void invalidate('app:invites');
  }

  $effect(() => {
    if (open) panel?.focus();
  });
</script>

<svelte:window
  onpointerdown={(event) => {
    if (!open) return;
    const target = event.target as Node;
    if (panel?.contains(target) || button?.contains(target)) return;
    dismiss({ focus: false });
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && open) dismiss({ focus: true });
  }}
/>

<div class="relative">
  <button
    bind:this={button}
    type="button"
    class="btn relative w-9 px-0 text-muted"
    onclick={toggle}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls="notifications-panel"
    aria-label={count ? m.notifications_label({ count: shown }) : m.notifications_title()}
  >
    <Bell size={15} aria-hidden="true" />
    {#if count}
      <span class="social-badge absolute -right-1 -top-1" aria-hidden="true">{shown}</span>
    {/if}
  </button>

  {#if open}
    <div
      bind:this={panel}
      id="notifications-panel"
      role="dialog"
      aria-label={m.notifications_title()}
      tabindex="-1"
      class="fixed inset-x-2 top-16 z-50 flex max-h-[min(70vh,32rem)] flex-col overflow-hidden rounded-md border border-line bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
    >
      <div class="border-b border-line px-3 py-2 text-sm font-semibold">
        {m.notifications_title()}
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-1">
        {#if loading && !items.length}
          <p class="px-2 py-6 text-center text-sm text-muted" aria-live="polite">…</p>
        {:else if !items.length}
          <p class="px-2 py-6 text-center text-sm text-muted">{m.notifications_empty()}</p>
        {:else}
          {#each items as notice (notice.id)}
            {@const Icon = KIND_ICONS[notice.kind]}
            <a
              href={notice.href}
              data-unread={notice.unread}
              class="flex gap-2.5 rounded px-2 py-2 transition-colors hover:bg-raised {notice.unread
                ? 'bg-accent/10'
                : ''}"
              onclick={() => (open = false)}
            >
              {#if notice.icon}
                <img
                  src={notice.icon}
                  alt=""
                  class="size-8 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              {:else}
                <span
                  class="grid size-8 shrink-0 place-items-center rounded bg-raised text-muted"
                  aria-hidden="true"
                >
                  <Icon size={15} />
                </span>
              {/if}

              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-1.5 text-[11px] text-muted">
                  <span class="truncate">{kindLabel(notice.kind)}</span>
                  <span class="ml-auto shrink-0">{formatRelative(notice.at)}</span>
                </span>
                <span class="block truncate text-sm font-medium">{notice.title}</span>
                {#if detail(notice)}
                  <span class="block truncate text-xs text-muted">{detail(notice)}</span>
                {/if}
              </span>

              {#if notice.unread}
                <span class="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"
                ></span>
                <span class="sr-only">{m.notification_unread()}</span>
              {/if}
            </a>
          {/each}
        {/if}
      </div>

      <div class="border-t border-line p-2">
        <button
          type="button"
          class="btn btn-ghost w-full"
          onclick={markAll}
          disabled={!hasUnread || marking}
        >
          {m.notifications_mark_all()}
        </button>
      </div>
    </div>
  {/if}
</div>
