<script lang="ts">
  import { Link } from '@lucide/svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Empty from '$lib/components/Empty.svelte';
  import GameCard from '$lib/components/GameCard.svelte';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import TrophyBadge from '$lib/components/TrophyBadge.svelte';
  import { formatDate, formatNumber, formatRelative, PROVIDER_LABELS } from '$lib/labels';
  import { toast } from '$lib/stores/toast';

  let { data } = $props();

  const profile = $derived(data.profile);
  const isMe = $derived(data.user?.id === profile.user.id);
  const stats = $derived([
    { label: 'Jeux', value: profile.stats.games },
    { label: 'Succès', value: profile.stats.unlocked },
    { label: 'Cartes 100 %', value: profile.stats.completed, gold: true },
    { label: 'Points', value: profile.stats.points },
  ]);

  async function share() {
    await navigator.clipboard.writeText(location.href);
    toast('Lien du profil copié.');
  }
</script>

<svelte:head>
  <title>{profile.user.displayName} — Project Achievers</title>
  <meta
    name="description"
    content="{formatNumber(profile.stats.unlocked)} succès et {profile.stats
      .completed} cartes de collection."
  />
  <meta property="og:title" content="{profile.user.displayName} sur Project Achievers" />
  <meta
    property="og:description"
    content="{formatNumber(profile.stats.unlocked)} succès sur {profile.stats.games} jeux"
  />
  {#if profile.user.avatarUrl}<meta property="og:image" content={profile.user.avatarUrl} />{/if}
</svelte:head>

<div class="space-y-8">
  <header class="flex flex-wrap items-center gap-4">
    <Avatar name={profile.user.displayName} src={profile.user.avatarUrl} size={64} />
    <div class="min-w-0">
      <h1>{profile.user.displayName}</h1>
      <p class="text-sm text-muted">
        Membre depuis le {formatDate(profile.user.createdAt)}
        {#if !profile.user.isPublic}· Profil privé{/if}
      </p>
      <ul class="mt-1 flex gap-3 text-muted">
        {#each profile.user.accounts as account (account.provider)}
          <li>
            <a
              href={account.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-ink"
              aria-label="{PROVIDER_LABELS[account.provider]} : {account.displayName}"
            >
              <ProviderIcon provider={account.provider} />
            </a>
          </li>
        {/each}
      </ul>
    </div>
    <div class="ml-auto flex gap-2">
      <button type="button" class="btn" onclick={share}>
        <Link size={14} aria-hidden="true" /> Partager
      </button>
      {#if data.user && !isMe}
        <a class="btn" href="/comparer?a={data.user.handle}&b={profile.user.handle}">Comparer</a>
      {/if}
    </div>
  </header>

  <dl class="card grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-line">
    {#each stats as stat (stat.label)}
      <div class="p-4">
        <dt class="label">{stat.label}</dt>
        <dd class="stat-value tabular mt-1" data-complete={stat.gold}>
          {formatNumber(stat.value)}
        </dd>
      </div>
    {/each}
  </dl>

  {#if profile.showcase.length}
    <section class="space-y-3" aria-labelledby="vitrine">
      <h2 id="vitrine">Vitrine</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {#each profile.showcase as row (row.game.id)}
          <GameCard game={row.game} progress={row} />
        {/each}
      </div>
    </section>
  {/if}

  {#if profile.games.length === 0}
    <Empty title="Aucun jeu synchronisé">
      {isMe ? 'Lie un compte de jeu pour remplir ton profil.' : 'Ce profil est encore vide.'}
      {#snippet action()}
        {#if isMe}<a href="/compte" class="btn btn-primary">Lier un compte</a>{/if}
      {/snippet}
    </Empty>
  {:else}
    <div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section class="space-y-3">
        <h2>Jeux</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each profile.games as row (row.game.id)}
            <GameCard game={row.game} progress={row} />
          {/each}
        </div>
      </section>

      <section class="space-y-3">
        <h2>Derniers succès</h2>
        <ul class="card divide-y divide-line">
          {#each profile.recent as item (item.achievement.id)}
            <li>
              <a
                href="/succes/{item.achievement.id}"
                class="block p-3 transition-colors hover:bg-raised"
              >
                <p class="truncate text-sm font-medium">{item.achievement.name}</p>
                <p class="flex justify-between gap-2 text-xs text-muted">
                  <span class="truncate">{item.achievement.game.name}</span>
                  <span class="shrink-0">{formatRelative(item.unlockedAt)}</span>
                </p>
                <TrophyBadge type={item.achievement.trophyType} />
              </a>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</div>
