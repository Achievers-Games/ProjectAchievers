<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import '../app.css';
  import { onMount } from 'svelte';
  import { invalidateAll, onNavigate } from '$app/navigation';
  import { navigating, page } from '$app/state';
  import Compass from '@lucide/svelte/icons/compass';
  import Flame from '@lucide/svelte/icons/flame';
  import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
  import Languages from '@lucide/svelte/icons/languages';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Search from '@lucide/svelte/icons/search';
  import Trophy from '@lucide/svelte/icons/trophy';
  import User from '@lucide/svelte/icons/user';
  import Avatar from '$lib/components/Avatar.svelte';
  import ChatDock from '$lib/components/ChatDock.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import RewardReveal from '$lib/components/RewardReveal.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import { LOCALE_LABELS, PROVIDER_LABELS, syncErrorText } from '$lib/labels';
  import { getLocale, locales, setLocale, type Locale } from '$lib/paraglide/runtime';
  import { hasDock, incoming, unread } from '$lib/stores/chat';
  import { refreshPresence, watchPresence } from '$lib/stores/presence';
  import { rewards, syncState, type SyncProgress } from '$lib/stores/sync';
  import { toast } from '$lib/stores/toast';
  import type { ChatEvent } from '$lib/server/sync/events';

  let { data, children } = $props();
  let paletteOpen = $state(false);

  const links = $derived([
    { href: '/', label: m.nav_home(), icon: Compass, exact: true },
    { href: '/jeux', label: m.nav_games(), icon: Gamepad2, exact: false },
    { href: '/communaute', label: m.nav_community(), icon: Trophy, exact: false },
    {
      href: data.user ? `/u/${data.user.handle}` : '/connexion',
      label: m.nav_profile(),
      icon: User,
      exact: false,
    },
  ]);

  // Sur mobile, un membre retrouve la communauté dans Social, avec ses messages.
  const mobileLinks = $derived(
    [
      ...links.slice(0, 2),
      { href: '/saison', label: m.nav_season(), icon: Flame, exact: false },
      data.user
        ? { href: '/messages', label: m.nav_social(), icon: MessageCircle, exact: false }
        : links[2],
      links[3],
    ].flatMap((link) => (link ? [link] : [])),
  );

  const inSocial = $derived(page.url.pathname.startsWith('/messages'));

  $effect(() => {
    unread.set(data.unread);
  });

  const userId = $derived(data.user?.id);
  const syncing = $derived(
    Object.values($syncState).some((s) => s.status === 'QUEUED' || s.status === 'SYNCING'),
  );

  /** Un message arrive : il s'ajoute aux non-lus, sauf si sa discussion est déjà ouverte. */
  function receive(event: ChatEvent) {
    incoming.set(event);
    if (event.message.author.id === userId) return;
    if (page.url.pathname === `/messages/${event.conversationId}`) return;
    if (hasDock() && !inSocial) return;
    unread.update((count) => count + 1);
  }

  async function refresh() {
    const response = await fetch('/api/sync', { method: 'POST' }).catch(() => null);
    if (!response?.ok) {
      toast(m.action_failed(), 'error');
      return;
    }
    const { started } = (await response.json()) as { started: number };
    toast(started > 0 ? m.refresh_started() : m.refresh_wait());
  }

  const isActive = (href: string, exact: boolean) =>
    exact ? page.url.pathname === href : page.url.pathname.startsWith(href);

  onMount(() => {
    document.documentElement.dataset.ready = 'true';
    return watchPresence();
  });

  // Progression des synchronisations : suivie partout, pour notifier la fin sur toute page.
  $effect(() => {
    if (!userId) return;
    const source = new EventSource('/api/sync/events');
    // Le joueur apparaît en ligne dès que ce flux est ouvert.
    source.onopen = () => void refreshPresence();
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as SyncProgress | ChatEvent;
      if ('type' in event) {
        receive(event);
        return;
      }
      syncState.update((state) => ({ ...state, [event.provider]: event }));
      if (event.status === 'COMPLETED') {
        const gained = event.achievements ?? 0;
        if (event.quiet && gained === 0 && !event.rewards?.length) return;
        toast(
          gained > 0
            ? m.sync_gained({ count: gained, platform: PROVIDER_LABELS[event.provider] })
            : m.sync_done({ platform: PROVIDER_LABELS[event.provider] }),
        );
        if (event.rewards?.length) {
          const cards = event.rewards;
          rewards.update((pending) => ({
            cards: [...pending.cards, ...cards],
            more: pending.more + (event.moreRewards ?? 0),
          }));
        }
        void invalidateAll();
      } else if (event.quiet) {
        return;
      } else if (event.status === 'FAILED' || event.status === 'NEEDS_RELINK') {
        toast(syncErrorText(event.error) ?? m.sync_failed(), 'error');
        void invalidateAll();
      }
    };
    return () => source.close();
  });

  onNavigate((navigation) => {
    // Le retour arrière n'attend pas : une transition en cours pourrait le bloquer.
    if (!document.startViewTransition || navigation.type === 'popstate') return;
    return new Promise((resolve) => {
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete.catch(() => {});
      });
      // Une navigation plus récente annule la transition : ce n'est pas une erreur.
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
    });
  });
</script>

<svelte:head>
  <title>Project Achievers</title>
  <meta name="description" content={m.site_description()} />
</svelte:head>

<a
  href="#contenu"
  class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50"
>
  {m.skip_to_content()}
</a>

{#if navigating.to}
  <div class="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-accent" aria-hidden="true"></div>
{/if}

<header class="sticky top-0 z-30 border-b border-line bg-bg/95">
  <div class="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
    <a href="/" class="font-semibold tracking-tight">Achievers</a>

    <nav aria-label={m.nav_main()} class="ml-4 hidden items-center gap-1 md:flex">
      {#each links.slice(0, 3) as link (link.href)}
        <a
          href={link.href}
          aria-current={isActive(link.href, link.exact) ? 'page' : undefined}
          class="rounded px-3 py-1.5 text-sm transition-colors hover:text-ink"
          class:text-muted={!isActive(link.href, link.exact)}
          class:bg-raised={isActive(link.href, link.exact)}
        >
          {link.label}
        </a>
      {/each}
      <a
        href="/saison"
        aria-current={isActive('/saison', false) ? 'page' : undefined}
        class="season-tab"
      >
        <Flame size={14} aria-hidden="true" />
        {m.nav_season()}
      </a>
    </nav>

    <div class="ml-auto flex items-center gap-2">
      <button
        type="button"
        class="btn w-9 px-0 text-muted sm:w-56 sm:justify-start sm:px-3"
        onclick={() => (paletteOpen = true)}
        aria-label={m.search_game()}
      >
        <Search size={15} aria-hidden="true" />
        <span class="hidden sm:inline">{m.search_short()}</span>
        <kbd class="ml-auto hidden text-xs sm:inline">Ctrl K</kbd>
      </button>

      <span class="btn relative w-9 px-0 text-muted">
        <Languages size={15} aria-hidden="true" />
        <select
          class="absolute inset-0 cursor-pointer opacity-0"
          aria-label={m.language_label()}
          value={getLocale()}
          onchange={(event) => setLocale(event.currentTarget.value as Locale)}
        >
          {#each locales as locale (locale)}
            <option value={locale}>{LOCALE_LABELS[locale]}</option>
          {/each}
        </select>
      </span>

      {#if data.user}
        <button
          type="button"
          class="btn w-9 px-0 text-muted"
          onclick={refresh}
          disabled={syncing}
          aria-label={m.refresh_label()}
          title={m.refresh_label()}
        >
          <RefreshCw
            size={15}
            class={syncing ? 'motion-safe:animate-spin' : ''}
            aria-hidden="true"
          />
        </button>
        <a
          href="/u/{data.user.handle}"
          class="flex items-center gap-2 rounded"
          aria-label={m.nav_profile()}
        >
          <Avatar person={data.user} />
        </a>
      {:else}
        <a href="/connexion" class="btn btn-primary">{m.sign_in()}</a>
      {/if}
    </div>
  </div>
</header>

<main id="contenu" class="mx-auto max-w-6xl px-4 pb-24 pt-6 md:pb-12">
  {@render children()}
</main>

<footer class="mx-auto hidden max-w-6xl gap-4 px-4 pb-8 text-xs text-muted md:flex">
  <span>Project Achievers</span>
  <a href="/confidentialite" class="hover:text-ink">{m.privacy()}</a>
</footer>

<nav
  aria-label={m.nav_mobile()}
  class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-bg md:hidden"
>
  {#each mobileLinks as link (link.href)}
    {@const Icon = link.icon}
    <a
      href={link.href}
      aria-current={isActive(link.href, link.exact) ? 'page' : undefined}
      class="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]"
      class:text-accent={isActive(link.href, link.exact)}
      class:text-muted={!isActive(link.href, link.exact)}
    >
      <span class="relative">
        <Icon size={18} aria-hidden="true" />
        {#if link.href === '/messages' && $unread}
          <span class="social-badge absolute -right-2 -top-1">{$unread}</span>
        {/if}
      </span>
      {link.label}
    </a>
  {/each}
</nav>

{#if data.user && !inSocial}<ChatDock me={data.user.id} />{/if}
<CommandPalette bind:open={paletteOpen} />
<RewardReveal />
<Toasts />
