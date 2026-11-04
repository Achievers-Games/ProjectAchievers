<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { page } from '$app/state';
  import { invites, unread } from '#lib/stores/chat';

  const links = $derived([
    { href: '/communaute', label: m.activity(), count: 0 },
    { href: '/messages', label: m.nav_messages(), count: $unread },
    { href: '/amis', label: m.nav_friends(), count: $invites.friends },
    { href: '/clan', label: m.nav_clan(), count: $invites.clans },
    { href: '/retours', label: m.feedback_title(), count: 0 },
  ]);

  const current = (href: string) => page.url.pathname.startsWith(href);
</script>

<nav aria-label={m.nav_community()} class="flex gap-1 overflow-x-auto">
  {#each links as link (link.href)}
    <a
      href={link.href}
      aria-current={current(link.href) ? 'page' : undefined}
      class="flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors hover:text-ink"
      class:bg-raised={current(link.href)}
      class:text-muted={!current(link.href)}
    >
      {link.label}
      {#if link.count}<span class="social-badge">{link.count}</span>{/if}
    </a>
  {/each}
</nav>
