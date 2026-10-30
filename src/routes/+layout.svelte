<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { invalidateAll, onNavigate } from '$app/navigation';
  import { navigating, page } from '$app/state';
  import { Compass, Gamepad2, Search, Trophy, User } from '@lucide/svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import RewardReveal from '$lib/components/RewardReveal.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import { PROVIDER_LABELS, plural } from '$lib/labels';
  import { rewards, syncState, type SyncProgress } from '$lib/stores/sync';
  import { toast } from '$lib/stores/toast';

  let { data, children } = $props();
  let paletteOpen = $state(false);

  const links = $derived([
    { href: '/', label: 'Accueil', icon: Compass, exact: true },
    { href: '/jeux', label: 'Jeux', icon: Gamepad2, exact: false },
    { href: '/communaute', label: 'Communauté', icon: Trophy, exact: false },
    {
      href: data.user ? `/u/${data.user.handle}` : '/connexion',
      label: 'Profil',
      icon: User,
      exact: false,
    },
  ]);

  const userId = $derived(data.user?.id);

  const isActive = (href: string, exact: boolean) =>
    exact ? page.url.pathname === href : page.url.pathname.startsWith(href);

  onMount(() => {
    document.documentElement.dataset.ready = 'true';
  });

  // Progression des synchronisations : suivie partout, pour notifier la fin sur toute page.
  $effect(() => {
    if (!userId) return;
    const source = new EventSource('/api/sync/events');
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as SyncProgress;
      syncState.update((state) => ({ ...state, [event.provider]: event }));
      if (event.status === 'COMPLETED') {
        const gained = event.achievements ?? 0;
        toast(
          gained > 0
            ? `${plural(gained, 'nouveau succès', 'nouveaux succès')} sur ${PROVIDER_LABELS[event.provider]} !`
            : `${PROVIDER_LABELS[event.provider]} est à jour.`,
        );
        if (event.moreRewards) {
          toast(
            `Et ${plural(event.moreRewards, 'autre carte', 'autres cartes')} dans ta collection.`,
          );
        }
        if (event.rewards?.length) rewards.update((list) => [...list, ...(event.rewards ?? [])]);
        void invalidateAll();
      } else if (event.status === 'FAILED' || event.status === 'NEEDS_RELINK') {
        toast(event.error ?? 'La synchronisation a échoué.', 'error');
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
  <meta
    name="description"
    content="Suis tes succès Steam, PlayStation et Xbox au même endroit, et partage ta collection."
  />
</svelte:head>

<a
  href="#contenu"
  class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50"
>
  Aller au contenu
</a>

{#if navigating.to}
  <div class="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-accent" aria-hidden="true"></div>
{/if}

<header class="sticky top-0 z-30 border-b border-line bg-bg/95">
  <div class="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
    <a href="/" class="font-semibold tracking-tight">Achievers</a>

    <nav aria-label="Navigation principale" class="ml-4 hidden items-center gap-1 md:flex">
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
    </nav>

    <div class="ml-auto flex items-center gap-2">
      <button
        type="button"
        class="btn w-9 px-0 text-muted sm:w-56 sm:justify-start sm:px-3"
        onclick={() => (paletteOpen = true)}
        aria-label="Rechercher un jeu"
      >
        <Search size={15} aria-hidden="true" />
        <span class="hidden sm:inline">Rechercher…</span>
        <kbd class="ml-auto hidden text-xs sm:inline">Ctrl K</kbd>
      </button>

      {#if data.user}
        <a href="/compte" class="flex items-center gap-2 rounded" aria-label="Mon compte">
          <Avatar name={data.user.displayName} src={data.user.avatarUrl} />
        </a>
      {:else}
        <a href="/connexion" class="btn btn-primary">Connexion</a>
      {/if}
    </div>
  </div>
</header>

<main id="contenu" class="mx-auto max-w-6xl px-4 pb-24 pt-6 md:pb-12">
  {@render children()}
</main>

<footer class="mx-auto hidden max-w-6xl gap-4 px-4 pb-8 text-xs text-muted md:flex">
  <span>Project Achievers</span>
  <a href="/confidentialite" class="hover:text-ink">Confidentialité</a>
</footer>

<nav
  aria-label="Navigation mobile"
  class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-bg md:hidden"
>
  {#each links as link (link.label)}
    {@const Icon = link.icon}
    <a
      href={link.href}
      aria-current={isActive(link.href, link.exact) ? 'page' : undefined}
      class="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]"
      class:text-accent={isActive(link.href, link.exact)}
      class:text-muted={!isActive(link.href, link.exact)}
    >
      <Icon size={18} aria-hidden="true" />
      {link.label}
    </a>
  {/each}
</nav>

<CommandPalette bind:open={paletteOpen} />
<RewardReveal />
<Toasts />
