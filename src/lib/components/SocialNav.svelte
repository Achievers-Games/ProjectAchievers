<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';

  const links = $derived([
    { href: '/messages', label: m.nav_messages(), mobile: false },
    { href: '/amis', label: m.nav_friends(), mobile: false },
    { href: '/clan', label: m.nav_clan(), mobile: false },
    { href: '/communaute', label: m.nav_community(), mobile: true },
  ]);
</script>

<nav aria-label={m.nav_social()} class="flex gap-1 overflow-x-auto">
  {#each links as link (link.href)}
    <a
      href={link.href}
      aria-current={page.url.pathname.startsWith(link.href) ? 'page' : undefined}
      class="shrink-0 rounded px-3 py-1.5 text-sm transition-colors hover:text-ink"
      class:md:hidden={link.mobile}
      class:bg-raised={page.url.pathname.startsWith(link.href)}
      class:text-muted={!page.url.pathname.startsWith(link.href)}
    >
      {link.label}
    </a>
  {/each}
</nav>
