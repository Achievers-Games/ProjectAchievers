<script lang="ts">
  import { page } from '$app/state';

  const navigation = [
    { name: 'Bibliothèque', to: '/games', icon: 'M6 12h4m-2-2v4M15 11h.01M18 13h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.59c-.006.052-.01.1-.013.15A17.9 17.9 0 0 0 2.25 12c0 2 .18 3.94.52 5.8A4 4 0 0 0 6.68 21h8.64a4 4 0 0 0 3.98-3.6A18.24 18.24 0 0 0 19.75 12c0-2-.18-3.94-.53-5.81A4 4 0 0 0 17.32 5z' },
    { name: 'Communauté', to: '/community', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { name: 'Profil', to: '/profile', icon: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
    { name: 'Paramètres', to: '/settings', icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  ];

  function isActive(pathname: string, to: string): boolean {
    return pathname === to || pathname.startsWith(`${to}/`);
  }
</script>

<aside class="sidebar">
  <a href="/" class="brand">
    <div class="brand-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M8.2 6h7.6M6 4h12v11a12 12 0 0 1-12 0z" /></svg>
    </div>
    <span class="brand-name">Achievers</span>
  </a>

  <nav class="nav">
    {#each navigation as item (item.to)}
      <a href={item.to} class="nav-item" class:active={isActive(page.url.pathname, item.to)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={item.icon} /></svg>
        {item.name}
      </a>
    {/each}
  </nav>
</aside>

<style>
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: 16rem;
    display: flex;
    flex-direction: column;
    z-index: 50;
    border-right: 1px solid hsl(var(--border));
    background: hsl(var(--background) / 80%);
    backdrop-filter: blur(16px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1.25rem 1.5rem;
  }

  .brand-mark {
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border-radius: 0.6rem;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }

  .brand-mark svg {
    width: 1rem;
    height: 1rem;
  }

  .brand-name {
    font-family: 'Unbounded', system-ui, sans-serif;
    font-weight: 700;
    font-size: 1.05rem;
    letter-spacing: -0.02em;
    color: hsl(var(--foreground));
  }

  .nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    overflow-y: auto;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
    transition: all 0.15s ease;
  }

  .nav-item svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }

  .nav-item:hover {
    background: hsl(var(--secondary));
    color: hsl(var(--foreground));
  }

  .nav-item.active {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    box-shadow: 0 8px 24px -8px hsl(var(--primary) / 60%);
  }
</style>
