<script lang="ts">
  import { relativeDate, platformColor } from '@/lib/games/gameMeta';
  import type { GameListItem } from '@/lib/tauri';

  let { game }: { game: GameListItem } = $props();

  const completion = $derived(game.user_progress?.completion_percentage ?? 0);
  const hasPlatinum = $derived(game.user_progress?.platinum_unlocked ?? false);
  const isComplete = $derived(completion >= 100);
</script>

<a href="/games/{game.slug}" class="dynamic-card shimmer-sweep reveal">
  <div class="cover">
    {#if game.cover_url}
      <img src={game.cover_url} alt={game.name} class="img" />
    {:else}
      <div class="img-bg">
        <span class="ico">🏆</span>
      </div>
    {/if}

    <div class="fade"></div>

    <span class="platform {platformColor(game.platform)}">
      {game.platform.charAt(0).toUpperCase() + game.platform.slice(1)}
    </span>

    {#if hasPlatinum}
      <span class="corner-platinum">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M8.2 6h7.6M6 4h12v11a12 12 0 0 1-12 0z" /></svg>
        Platine
      </span>
    {:else if isComplete}
      <span class="corner-gold">100%</span>
    {/if}

    <div class="ring">
      {@render CompletionRing({ value: completion })}
    </div>
  </div>

  <div class="body">
    <h3>{game.name}</h3>
    <div class="progress-row">
      <div class="progress"><div class="fill" style:width="{Math.min(100, Math.max(0, completion))}%"></div></div>
      <span class="pct">{completion.toFixed(0)}%</span>
    </div>
    <div class="meta">
      <span class="mono">{game.user_progress?.unlocked_count ?? 0}/{game.total_achievements} succès</span>
      {#if game.user_progress?.last_unlocked_at}
        <span>{relativeDate(game.user_progress.last_unlocked_at)}</span>
      {/if}
    </div>
  </div>
</a>

{#snippet CompletionRing({ value }: { value: number })}
  {@const size = 44}{@const stroke = 4}{@const r = (size - stroke) / 2}
  {@const c = 2 * Math.PI * r}
  {@const pct = Math.min(100, Math.max(0, value))}
  <svg width={size} height={size} viewBox="0 0 {size} {size}" class="ring-svg">
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.25)" stroke-width={stroke} />
    <circle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      stroke={pct >= 100 ? 'hsl(45 95% 55%)' : 'hsl(15 92% 56%)'}
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={c}
      stroke-dashoffset={c * (1 - pct / 100)}
      transform="rotate(-90 {size / 2} {size / 2})"
    />
    <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="11" font-weight="700">
      {pct.toFixed(0)}
    </text>
  </svg>
{/snippet}

<style>
  .cover {
    position: relative;
    aspect-ratio: 10 / 6;
    overflow: hidden;
  }

  .img,
  .img-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .img {
    transition: transform 0.5s ease-out;
  }

  .cover:hover .img {
    transform: scale(1.06);
  }

  .img-bg {
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, hsl(var(--secondary)), hsl(var(--muted)));
  }

  .ico {
    font-size: 1.5rem;
    opacity: 0.4;
  }

  .fade {
    position: absolute;
    inset: auto 0 0 0;
    height: 3rem;
    background: linear-gradient(180deg, transparent, rgb(0 0 0 / 70%));
  }

  .platform {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 10;
    padding: 0.25rem 0.625rem;
    border: 1px solid hsl(var(--border) / 60%);
    border-radius: 9999px;
    backdrop-filter: blur(10px);
    background: rgb(0 0 0 / 40%);
    font-size: 0.6875rem;
    font-weight: 600;
    color: white;
  }

  .platform.steam {
    border-color: hsl(214 100% 60% / 50%);
    color: hsl(214 100% 75%);
  }

  .platform.psn {
    border-color: hsl(340 83% 62% / 50%);
    color: hsl(340 100% 80%);
  }

  .platform.xbox {
    border-color: hsl(201 98% 50% / 60%);
    color: hsl(201 100% 75%);
  }

  .corner-platinum,
  .corner-gold {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 10;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    backdrop-filter: blur(10px);
    background: rgb(0 0 0 / 40%);
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .corner-platinum {
    border: 1px solid hsl(203 89% 60% / 40%);
    color: hsl(203 89% 75%);
  }

  .corner-gold {
    border: 1px solid hsl(45 95% 55% / 40%);
    color: hsl(45 95% 65%);
  }

  .corner-platinum svg {
    width: 0.75rem;
    height: 0.75rem;
  }

  .ring {
    position: absolute;
    bottom: 0.75rem;
    right: 0.75rem;
    z-index: 10;
    filter: drop-shadow(0 2px 6px rgb(0 0 0 / 50%));
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 1rem;
  }

  h3 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
    font-weight: 600;
    transition: color 0.15s ease;
  }

  h3:hover {
    color: hsl(var(--primary));
  }

  .progress-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .progress {
    position: relative;
    flex: 1;
    height: 0.375rem;
    border-radius: 9999px;
    background: hsl(var(--secondary));
    overflow: hidden;
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 9999px;
    background: linear-gradient(90deg, hsl(15 92% 56%), hsl(42 95% 55%));
    transition: width 0.5s ease-out;
  }

  .pct {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
</style>
