<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { page } from '$app/state';
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

  /** Une notification, dans la cloche comme sur la page qui les liste toutes. */
  let { notice, onclick }: { notice: Notice; onclick?: () => void } = $props();

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

  const detail = $derived(
    notice.detail
      ? displayText(notice.detail, page.data.user?.allowProfanity, notice.detailLocale)
      : '',
  );
  const Icon = $derived(KIND_ICONS[notice.kind]);
</script>

<a
  href={notice.href}
  data-unread={notice.unread}
  class="flex gap-2.5 rounded px-2 py-2 transition-colors hover:bg-raised {notice.unread
    ? 'bg-accent/10'
    : ''}"
  {onclick}
>
  {#if notice.icon}
    <img src={notice.icon} alt="" class="size-8 shrink-0 rounded object-cover" loading="lazy" />
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
    {#if detail}
      <span class="block truncate text-xs text-muted">{detail}</span>
    {/if}
  </span>

  {#if notice.unread}
    <span class="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
    <span class="sr-only">{m.notification_unread()}</span>
  {/if}
</a>
