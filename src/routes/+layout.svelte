<script lang="ts">
  import '../globals.css';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import Sidebar from '@/lib/layout/Sidebar.svelte';
  import { toasts, type Toast } from '@/lib/stores/toast';
  import { initTheme } from '@/lib/stores/theme';

  let { children }: { children: Snippet } = $props();

  onMount(initTheme);

  let sidebarOpen = $state(false);
  let globalSearch = $state('');

  const kindIcon: Record<Toast['kind'], string> = {
    success: 'M20 6 9 17l-5-5',
    error: 'M18 6 6 18M6 6l12 12',
  };
</script>

<div class="app">
  <div class="ambient -left-40 -top-40"></div>
  <div class="ambient -right-40 -bottom-56"></div>

  {#if sidebarOpen}
    <div class="overlay" onclick={() => (sidebarOpen = false)} aria-hidden="true"></div>
  {/if}

  <div class="drawer" class:open={sidebarOpen}>
    <Sidebar />
  </div>

  <div class="main">
    <header class="header">
      <button
        class="menu-btn"
        onclick={() => (sidebarOpen = !sidebarOpen)}
        aria-label="Ouvrir le menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>

      <div class="searchbeam">
        <svg class="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          type="search"
          placeholder="Rechercher un jeu, un succès…"
          bind:value={globalSearch} />
      </div>

      <div class="eyebrow-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v1.5M12 19.5V21M4.9 4.9l1.1 1.1M18 18l1.1 1.1M2.8 12h1.5M19.7 12h1.5M4.9 19.1 6 18M18 6l1.1-1.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8" /></svg>
        Chasse aux succès
      </div>
    </header>

    <main class="content">{@render children()}</main>
  </div>

  <!-- Toasts -->
  <div class="toaststack">
    {#each $toasts as toast (toast.id)}
      <div class="toast {toast.kind}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d={kindIcon[toast.kind]} /></svg>
        <div>
          <p class="toast-msg">{toast.message}</p>
          {#if toast.description}
            <p class="toast-desc">{toast.description}</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .app {
    position: relative;
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .ambient {
    pointer-events: none;
    position: absolute;
    border-radius: 50%;
    filter: blur(64px);
    opacity: 0.6;
    background: radial-gradient(closest-side, hsl(var(--primary) / 18%), transparent 70%);
  }

  .drawer {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 50;
    width: 16rem;
    height: 100%;
    transition: transform 0.3s ease;
    transform: translateX(-100%);
  }

  .drawer.open {
    transform: translateX(0);
  }

  @media (min-width: 1024px) {
    .drawer {
      transform: translateX(0);
    }
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(0 0 0 / 60%);
    backdrop-filter: blur(4px);
  }

  .menu-btn {
    display: grid;
    place-items: center;
    padding: 0.5rem;
    border-radius: 0.75rem;
    color: hsl(var(--muted-foreground));
    transition: background 0.15s ease;
  }

  .menu-btn:hover {
    background: hsl(var(--secondary));
  }

  @media (min-width: 1024px) {
    .menu-btn {
      display: none;
    }
  }

  .main {
    position: relative;
    z-index: 10;
    display: flex;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
  }

  @media (min-width: 1024px) {
    .main {
      padding-left: 16rem;
    }
  }

  .header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid hsl(var(--border) / 60%);
    background: hsl(var(--background) / 70%);
    backdrop-filter: blur(20px);
  }

  .menu-btn svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  .searchbeam {
    position: relative;
    width: 100%;
    max-width: 28rem;
  }

  .search-ico {
    position: absolute;
    left: 0.875rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1rem;
    height: 1rem;
    color: hsl(var(--muted-foreground));
    pointer-events: none;
  }

  .searchbeam input {
    width: 100%;
    padding: 0.625rem 1rem 0.625rem 2.5rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border) / 70%);
    background: hsl(var(--secondary) / 50%);
    color: hsl(var(--foreground));
    font-size: 0.875rem;
    outline: none;
  }

  .searchbeam input:focus {
    border-color: hsl(var(--primary) / 40%);
  }

  .eyebrow-badge {
    margin-left: auto;
    display: none;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    border: 1px solid hsl(var(--accent) / 25%);
    border-radius: 9999px;
    background: hsl(var(--accent) / 10%);
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: hsl(var(--accent));
    white-space: nowrap;
  }

  .eyebrow-badge svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  @media (min-width: 640px) {
    .eyebrow-badge {
      display: flex;
    }
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    color: hsl(var(--foreground));
  }

  @media (min-width: 1024px) {
    .content {
      padding: 2.5rem;
    }
  }

  .toaststack {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    min-width: 17rem;
    max-width: 24rem;
    padding: 0.75rem 1rem;
    border-radius: 1rem;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--card));
    box-shadow: 0 18px 40px -16px rgb(0 0 0 / 60%);
    animation: toast-in 0.25s ease-out both;
  }

  .toast svg {
    width: 1rem;
    height: 1rem;
    margin-top: 0.125rem;
  }

  .toast.success svg {
    color: hsl(142 71% 45%);
  }

  .toast.error svg {
    color: hsl(0 84% 60%);
  }

  .toast-msg {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .toast-desc {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    margin-top: 0.125rem;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
