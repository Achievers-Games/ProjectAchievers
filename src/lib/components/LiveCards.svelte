<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import Avatar from './Avatar.svelte';
  import type { CardDrop } from '$lib/collection';
  import { formatRelative } from '$lib/labels';

  const MAX_DROPS = 12;

  let { initial }: { initial: CardDrop[] } = $props();

  let live = $state<CardDrop[]>([]);

  const keyOf = (drop: CardDrop) => `${drop.user.handle}-${drop.game.slug}`;

  // Une carte reçue en direct passe devant celles déjà connues, sans doublon.
  const drops = $derived(
    [...new Map([...live, ...initial].map((drop) => [keyOf(drop), drop])).values()].slice(
      0,
      MAX_DROPS,
    ),
  );

  $effect(() => {
    const source = new EventSource('/api/cartes');
    source.onmessage = (message) => {
      live = [JSON.parse(message.data) as CardDrop, ...live].slice(0, MAX_DROPS);
    };
    return () => source.close();
  });
</script>

<section class="space-y-3" aria-labelledby="direct">
  <h2 id="direct" class="flex items-center gap-2">
    <span class="live-dot" aria-hidden="true"></span>
    {m.live_title()}
    <span class="text-sm font-normal text-muted">{m.live_subtitle()}</span>
  </h2>

  {#if drops.length === 0}
    <p class="text-sm text-muted">{m.live_empty()}</p>
  {:else}
    <ul class="live-rail" aria-live="polite">
      {#each drops as drop (keyOf(drop))}
        <li animate:flip={{ duration: 250 }} in:fly={{ x: -40, duration: 300 }}>
          <a href="/jeux/{drop.game.slug}" class="drop-tile">
            {#if drop.game.headerUrl}
              <img src={drop.game.headerUrl} alt="" loading="lazy" class="drop-image" />
            {/if}
            <span class="drop-body">
              <span class="flex items-center gap-1.5">
                <Avatar name={drop.user.displayName} src={drop.user.avatarUrl} size={18} />
                <span class="truncate text-xs font-semibold">{drop.user.displayName}</span>
              </span>
              <span class="block truncate text-sm font-bold text-gold">{drop.game.name}</span>
              <span class="block text-xs text-muted">{formatRelative(drop.unlockedAt)}</span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
