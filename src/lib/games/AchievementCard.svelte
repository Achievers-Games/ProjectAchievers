<script lang="ts">
  import type { AchievementWithProgress } from '@/lib/tauri';

  let { achievement }: { achievement: AchievementWithProgress } = $props();

  const icon = $derived(
    achievement.unlocked ? achievement.icon_url : achievement.icon_gray_url ?? achievement.icon_url,
  );

  const trophyClass = $derived(
    achievement.trophy_type === 'platinum'
      ? 'platinum'
      : achievement.trophy_type === 'gold'
        ? 'gold'
        : achievement.trophy_type === 'silver'
          ? 'silver'
          : achievement.trophy_type === 'bronze'
            ? 'bronze'
            : 'plain',
  );
</script>

<a href="/achievements/{achievement.id}" class="card" class:unlocked={achievement.unlocked}>
  <div class="icon-wrap">
    {#if icon}
      <img src={icon} alt={achievement.name} loading="lazy" />
    {:else}
      <div class="icon-fallback">🏆</div>
    {/if}
    {#if achievement.unlocked}
      <span class="check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5" /></svg>
      </span>
    {/if}
    {#if achievement.hidden && !achievement.unlocked}
      <div class="hidden-mask">???</div>
    {/if}
  </div>

  <div class="info">
    <div class="topline">
      {#if achievement.trophy_type}
        <span class="trophy {trophyClass}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M8.2 6h7.6M6 4h12v11a12 12 0 0 1-12 0z" /></svg>
          {achievement.trophy_type}
        </span>
      {/if}
      {#if achievement.unlocked && achievement.unlocked_at}
        <span class="date">{new Date(achievement.unlocked_at).toLocaleDateString('fr-FR')}</span>
      {/if}
    </div>
    <h3>{achievement.name}</h3>
    <p class="desc">{achievement.description || 'Description non disponible'}</p>
    <div class="meta">
      <span class="mono">{Math.max(0, achievement.global_rarity ?? 0).toFixed(1)} % des joueurs</span>
      <span class="mono">{achievement.points} pts</span>
    </div>
  </div>
</a>

<style>
  .card {
    display: flex;
    gap: 0.75rem;
    padding: 0.8rem;
    border: 1px solid hsl(var(--border) / 80%);
    border-radius: 1rem;
    background: linear-gradient(180deg, hsl(var(--card)), hsl(var(--card) / 60%));
    transition: all 0.2s ease;
  }

  .card:hover {
    border-color: hsl(var(--primary) / 40%);
    transform: translateY(-2px);
  }

  .card.unlocked {
    border-color: hsl(var(--primary) / 25%);
    background: linear-gradient(180deg, hsl(var(--primary) / 8%), hsl(var(--card) / 60%));
  }

  .icon-wrap {
    position: relative;
    width: 3.4rem;
    height: 3.4rem;
    flex-shrink: 0;
    border-radius: 0.75rem;
    overflow: hidden;
  }

  .icon-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .icon-fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    background: hsl(var(--secondary));
    font-size: 1.2rem;
    opacity: 0.6;
  }

  .check {
    position: absolute;
    right: -0.15rem;
    bottom: -0.15rem;
    width: 1.15rem;
    height: 1.15rem;
    display: grid;
    place-items: center;
    border-radius: 9999px;
    background: hsl(142 71% 45%);
    color: white;
    border: 2px solid hsl(var(--card));
  }

  .check svg {
    width: 0.6rem;
    height: 0.6rem;
  }

  .hidden-mask {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 60%);
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .topline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .trophy {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.05rem 0.4rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border));
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: capitalize;
    color: hsl(var(--muted-foreground));
  }

  .trophy svg {
    width: 0.65rem;
    height: 0.65rem;
  }

  .trophy.platinum {
    color: hsl(203 89% 75%);
    border-color: hsl(203 89% 60% / 40%);
    background: hsl(203 89% 60% / 10%);
  }

  .trophy.gold {
    color: hsl(45 95% 65%);
    border-color: hsl(45 95% 55% / 40%);
    background: hsl(45 95% 55% / 10%);
  }

  .trophy.silver {
    color: hsl(210 12% 75%);
    border-color: hsl(210 12% 68% / 40%);
    background: hsl(210 12% 68% / 10%);
  }

  .trophy.bronze {
    color: hsl(20 83% 65%);
    border-color: hsl(20 83% 55% / 40%);
    background: hsl(20 83% 55% / 10%);
  }

  .date {
    margin-left: auto;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.625rem;
    color: hsl(var(--muted-foreground));
  }

  h3 {
    margin-top: 0.2rem;
    font-size: 0.875rem;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .desc {
    margin-top: 0.1rem;
    font-size: 0.72rem;
    color: hsl(var(--muted-foreground));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.3rem;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.625rem;
    color: hsl(var(--muted-foreground) / 80%);
  }
</style>
