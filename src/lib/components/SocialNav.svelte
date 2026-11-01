<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';

  const links = $derived([
    { href: '/communaute', label: m.activity() },
    { href: '/messages', label: m.nav_messages() },
    { href: '/amis', label: m.nav_friends() },
    { href: '/clan', label: m.nav_clan() },
  ]);

  const current = (href: string) => page.url.pathname.startsWith(href);
</script>

<nav aria-label={m.nav_community()} class="flex gap-1 overflow-x-auto">
  {#each links as link (link.href)}
    <a
      href={link.href}
      aria-current={current(link.href) ? 'page' : undefined}
      class="shrink-0 rounded px-3 py-1.5 text-sm transition-colors hover:text-ink"
      class:bg-raised={current(link.href)}
      class:text-muted={!current(link.href)}
    >
      {link.label}
    </a>
  {/each}
</nav>
