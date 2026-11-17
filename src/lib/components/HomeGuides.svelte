<script lang="ts">
  import BookOpen from '@lucide/svelte/icons/book-open';
  import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
  import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
  import { m } from '#lib/paraglide/messages';
  import { formatRelative } from '#lib/labels';

  interface HomeGuide {
    id: string;
    title: string | null;
    score: number;
    createdAt: Date | string;
    author: { displayName: string };
    game: { slug: string; name: string; headerUrl: string | null } | null;
  }

  /** Les derniers guides de jeu : les officiels, et ceux que la communauté a jugés utiles. */
  let { official, community }: { official: HomeGuide[]; community: HomeGuide[] } = $props();
</script>

{#snippet column(title: string, guides: HomeGuide[], empty: string, showScore: boolean)}
  <div class="min-w-0 space-y-2">
    <h3 class="text-sm font-semibold text-muted">{title}</h3>
    {#if guides.length}
      <ul class="space-y-2">
        {#each guides as guide (guide.id)}
          {#if guide.game}
            <li>
              <a
                href="/jeux/{guide.game.slug}/guides/{guide.id}"
                class="card flex items-center gap-3 p-2 transition-colors hover:bg-raised"
              >
                <span class="h-10 w-20 shrink-0 overflow-hidden rounded bg-raised">
                  {#if guide.game.headerUrl}
                    <img
                      src={guide.game.headerUrl}
                      alt=""
                      loading="lazy"
                      class="h-full w-full object-cover"
                    />
                  {:else}
                    <span class="grid h-full place-items-center text-muted" aria-hidden="true">
                      <Gamepad2 size={18} />
                    </span>
                  {/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{guide.title ?? guide.game.name}</span>
                  <span class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span class="truncate">{guide.game.name}</span>
                    {#if showScore}
                      <span class="tabular flex items-center gap-1" title={m.game_guide_score()}>
                        <ThumbsUp size={12} aria-hidden="true" />{guide.score}
                      </span>
                      <span>{guide.author.displayName}</span>
                    {/if}
                    <span>{formatRelative(guide.createdAt)}</span>
                  </span>
                </span>
              </a>
            </li>
          {/if}
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted">{empty}</p>
    {/if}
  </div>
{/snippet}

<section class="space-y-3" aria-labelledby="derniers-guides">
  <h2 id="derniers-guides" class="flex items-center gap-2">
    <BookOpen size={18} aria-hidden="true" />{m.home_guides()}
  </h2>
  <div class="grid gap-4 md:grid-cols-2">
    {@render column(m.home_guides_official(), official, m.home_guides_official_empty(), false)}
    {@render column(m.home_guides_community(), community, m.home_guides_community_empty(), true)}
  </div>
</section>
