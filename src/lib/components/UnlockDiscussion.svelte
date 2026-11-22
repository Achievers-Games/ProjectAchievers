<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { formatDateTime } from '#lib/labels';
  import RarityBadge from './RarityBadge.svelte';
  import type { loadUnlockDiscussion } from '#lib/server/activity';
  import AchievementIcon from './AchievementIcon.svelte';
  import ActivityReactions from './ActivityReactions.svelte';
  import Discussion from './Discussion.svelte';

  let {
    thread,
    actionQuery = '',
    modal = false,
  }: {
    thread: Awaited<ReturnType<typeof loadUnlockDiscussion>>;
    actionQuery?: string;
    modal?: boolean;
  } = $props();
</script>

<div class="space-y-4">
  <div class="flex items-start gap-3">
    {#if thread.iconUrl}<AchievementIcon src={thread.iconUrl} size={44} />{/if}
    <div class="min-w-0">
      {#if modal}
        <h2 id="unlock-dialog-title">{thread.name ?? m.achievement_hidden()}</h2>
      {:else}
        <h1>{thread.name ?? m.achievement_hidden()}</h1>
      {/if}
      {#if thread.description}
        <p class="text-sm" data-testid="unlock-description">{thread.description}</p>
      {/if}
      <p class="text-sm text-muted">
        <a class="font-medium hover:text-ink" href="/u/{thread.user.handle}"
          >{thread.user.displayName}</a
        >
        ·
        <a class="hover:text-ink" href="/jeux/{thread.game.slug}?joueur={thread.user.handle}"
          >{thread.game.name}</a
        >
        · {formatDateTime(thread.unlockedAt)}
      </p>
      <RarityBadge rarity={thread.globalRarity} />
    </div>
  </div>
  <ActivityReactions
    kind="unlock"
    handle={thread.user.handle}
    id={thread.achievementId}
    summary={thread.reactions}
    signedIn
  />
  <Discussion
    comments={thread.comments}
    signedIn
    signInHref="/connexion"
    canTranslate={thread.canTranslate}
    {actionQuery}
  />
</div>
