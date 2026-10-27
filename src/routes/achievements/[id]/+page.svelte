<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import {
    tauriApi,
    type AchievementDetail,
    type AchievementGuide,
    type Comment,
    type CommentReactions,
  } from '@/lib/tauri';
  import { formatNumber, formatRelativeDate } from '@/lib/utils';
  import { toast } from '@/lib/stores/toast';

  type Tab = 'guides' | 'comments';

  let detail = $state<AchievementDetail | null>(null);
  let guides = $state<AchievementGuide[]>([]);
  let comments = $state<Comment[]>([]);
  let tab = $state<Tab>('guides');
  let loading = $state(true);

  let writingGuide = $state(false);
  let guideDraft = $state('');
  let guideVideo = $state('');
  let savingGuide = $state(false);

  let commentDraft = $state('');
  let savingComment = $state(false);
  let replyingTo = $state<string | null>(null);
  let replyDraft = $state('');
  let savingReply = $state(false);

  const achievementId = page.params.id ?? '';

  onMount(async () => {
    try {
      const d = await tauriApi.getAchievementDetail(achievementId);
      detail = d;
      const [g, c] = await Promise.allSettled([
        tauriApi.getAchievementGuides(achievementId),
        tauriApi.getComments(achievementId),
      ]);
      if (g.status === 'fulfilled') guides = g.value;
      if (c.status === 'fulfilled') comments = c.value;
    } catch {
      detail = null;
    } finally {
      loading = false;
    }
  });

  const achievement = $derived(detail?.achievement);
  const trophy = $derived(achievement?.trophy_type ?? 'achievement');
  const icon = $derived(
    achievement
      ? achievement.unlocked
        ? achievement.icon_url
        : (achievement.icon_gray_url ?? achievement.icon_url)
      : null,
  );
  const rarity = $derived(Math.max(0, achievement?.global_rarity ?? 0));
  const rarityTone = $derived(
    rarity <= 5 ? 'ultra-rare' : rarity <= 15 ? 'rare' : rarity <= 40 ? 'uncommon' : 'common',
  );

  async function reloadGuides() {
    const g = await tauriApi.getAchievementGuides(achievementId);
    guides = g;
    if (detail) detail = { ...detail, guide_count: g.length };
  }

  async function reloadComments() {
    const c = await tauriApi.getComments(achievementId);
    comments = c;
    if (detail) detail = { ...detail, comment_count: c.length };
  }

  async function submitGuide() {
    const content = guideDraft.trim();
    if (content.length < 10) {
      toast.error('Guide trop court', 'Décris la marche à suivre en quelques phrases.');
      return;
    }
    savingGuide = true;
    try {
      await tauriApi.createGuide({
        achievement_id: achievementId,
        content_md: content,
        content_type: 'community',
        video_url: guideVideo.trim() || null,
        images: [],
      });
      guideDraft = '';
      guideVideo = '';
      writingGuide = false;
      await reloadGuides();
      toast.success('Guide publié', 'Merci pour la communauté.');
    } catch (e) {
      toast.error('Publication impossible', e instanceof Error ? e.message : String(e));
    } finally {
      savingGuide = false;
    }
  }

  async function vote(guide: AchievementGuide, direction: 'up' | 'down') {
    try {
      const result = await tauriApi.voteGuide(guide.id, direction);
      guides = guides.map((g) =>
        g.id === guide.id
          ? { ...g, upvotes: result.upvotes, downvotes: result.downvotes, user_vote: result.user_vote }
          : g,
      );
    } catch (e) {
      toast.error('Vote impossible', e instanceof Error ? e.message : String(e));
    }
  }

  async function submitComment() {
    const content = commentDraft.trim();
    if (content.length < 2) return;
    savingComment = true;
    try {
      await tauriApi.createComment({ achievement_id: achievementId, content_md: content });
      commentDraft = '';
      await reloadComments();
      toast.success('Message publié');
    } catch (e) {
      toast.error('Publication impossible', e instanceof Error ? e.message : String(e));
    } finally {
      savingComment = false;
    }
  }

  async function submitReply(parent: Comment) {
    const content = replyDraft.trim();
    if (content.length < 2) return;
    savingReply = true;
    try {
      await tauriApi.createComment({
        achievement_id: achievementId,
        content_md: content,
        parent_id: parent.id,
      });
      replyDraft = '';
      replyingTo = null;
      await reloadComments();
      toast.success('Réponse publiée');
    } catch (e) {
      toast.error('Réponse impossible', e instanceof Error ? e.message : String(e));
    } finally {
      savingReply = false;
    }
  }

  async function react(comment: Comment, type: keyof CommentReactions) {
    try {
      const reactions = await tauriApi.reactToComment({
        comment_id: comment.id,
        reaction_type: type,
      });
      patchComment(comment.id, { reactions, user_reaction: type });
    } catch (e) {
      toast.error('Réaction impossible', e instanceof Error ? e.message : String(e));
    }
  }

  function patchComment(id: string, patch: Partial<Comment>) {
    comments = comments.map((c) => {
      if (c.id === id) return { ...c, ...patch };
      if (c.replies?.length) {
        return {
          ...c,
          replies: c.replies.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        };
      }
      return c;
    });
  }

  const reactionEmoji: Record<keyof CommentReactions, string> = {
    helpful: '💡',
    funny: '😄',
    thanks: '🙏',
    heart: '❤️',
  };

  const reactionLabel: Record<keyof CommentReactions, string> = {
    helpful: 'Utile',
    funny: 'Drôle',
    thanks: 'Merci',
    heart: "J'aime",
  };
</script>

<svelte:head><title>{achievement?.name ?? 'Succès'} — Project Achievers</title></svelte:head>

{#if loading}
  <div class="skeleton-hero"></div>
{:else if !detail || !achievement}
  <div class="notfound dynamic-card">
    <h2>Succès introuvable</h2>
    <p>Ce succès n'existe pas ou a été retiré de la collection.</p>
    <a class="btn-glossy" href="/games">Retour à la bibliothèque</a>
  </div>
{:else}
  <div class="page">
    <nav class="crumbs" aria-label="Fil d'Ariane">
      <a href="/games">Bibliothèque</a>
      <span>/</span>
      <a href="/games/{detail.game_slug}">{detail.game_name}</a>
      <span>/</span>
      <span class="current">Succès</span>
    </nav>

    <section class="hero">
      {#if detail.game_header_url ?? detail.game_cover_url}
        <div class="hero-bg">
          <img src={detail.game_header_url ?? detail.game_cover_url ?? ''} alt="" />
          <div class="hero-veil"></div>
        </div>
      {/if}

      <div class="hero-body">
        <div class="icon-shell {trophy}" class:locked={!achievement.unlocked}>
          {#if icon}
            <img src={icon} alt={achievement.name} />
          {:else}
            <span class="icon-fallback">🏆</span>
          {/if}
          {#if achievement.unlocked}
            <span class="check" title="Débloqué">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5" /></svg>
            </span>
          {/if}
        </div>

        <div class="hero-info">
          <div class="badges">
            <span class="trophy-chip {trophy}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M8.2 6h7.6M6 4h12v11a12 12 0 0 1-12 0z" /></svg>
              {trophy}
            </span>
            {#if achievement.is_platinum}
              <span class="badge platinum">Platine</span>
            {/if}
            {#if achievement.hidden}
              <span class="badge">Masquable</span>
            {/if}
          </div>

          <h1>{achievement.name}</h1>
          <p class="desc">{achievement.description || 'Description non disponible.'}</p>

          <div class="meta-row">
            <span class="rarity {rarityTone}">{rarity.toFixed(1)} % des joueurs</span>
            <span class="dot"></span>
            <span class="mono">{formatNumber(achievement.points)} pts</span>
            {#if achievement.unlocked && achievement.unlocked_at}
              <span class="dot"></span>
              <span class="unlocked-date">Débloqué le {new Date(achievement.unlocked_at).toLocaleDateString('fr-FR')}</span>
            {:else}
              <span class="dot"></span>
              <span class="locked-label">Pas encore débloqué</span>
            {/if}
          </div>
        </div>

        <a class="game-link" href="/games/{detail.game_slug}">
          {#if detail.game_cover_url}
            <img src={detail.game_cover_url} alt="" />
          {/if}
          <span>
            <small>Jeu</small>
            <strong>{detail.game_name}</strong>
          </span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </a>
      </div>
    </section>

    <section class="stats">
      <div class="dynamic-card stat">
        <p class="label">Rareté mondiale</p>
        <p class="stat-numeral value">{rarity.toFixed(1)}%</p>
      </div>
      <div class="dynamic-card stat">
        <p class="label">Guides</p>
        <p class="stat-numeral value">{guides.length}</p>
      </div>
      <div class="dynamic-card stat">
        <p class="label">Messages</p>
        <p class="stat-numeral value">{detail.comment_count}</p>
      </div>
      <div class="dynamic-card stat">
        <p class="label">Statut</p>
        <p class="stat-numeral value status" class:done={achievement.unlocked}>
          {achievement.unlocked ? 'Obtenu' : 'À faire'}
        </p>
      </div>
    </section>

    <div class="tabs-bar">
      <button class:active={tab === 'guides'} onclick={() => (tab = 'guides')}>
        Guides <span class="count">{guides.length}</span>
      </button>
      <button class:active={tab === 'comments'} onclick={() => (tab = 'comments')}>
        Discussion <span class="count">{detail.comment_count}</span>
      </button>
    </div>

    {#if tab === 'guides'}
      <section class="guides-section">
        <div class="section-head">
          <div>
            <h2>Guides de la communauté</h2>
            <p class="section-sub">Astuces vérifiées, vidéos et méthodes pas à pas.</p>
          </div>
          <button class="btn-glossy" onclick={() => (writingGuide = !writingGuide)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            {writingGuide ? 'Fermer' : 'Rédiger un guide'}
          </button>
        </div>

        {#if writingGuide}
          <div class="composer dynamic-card">
            <textarea
              bind:value={guideDraft}
              rows="6"
              placeholder="Explique la méthode, les prérequis, le build conseillé…"
              disabled={savingGuide}
            ></textarea>
            <input
              type="url"
              bind:value={guideVideo}
              placeholder="Lien vidéo (optionnel)"
              disabled={savingGuide}
            />
            <div class="composer-foot">
              <span class="hint">Les retours à la ligne sont conservés.</span>
              <button class="btn-glossy" onclick={submitGuide} disabled={savingGuide}>
                {savingGuide ? 'Publication…' : 'Publier le guide'}
              </button>
            </div>
          </div>
        {/if}

        {#if guides.length === 0}
          <div class="empty dynamic-card">
            <div class="empty-ico">📝</div>
            <h3>Aucun guide pour ce succès</h3>
            <p>Sois le premier à partager ta méthode avec les autres chasseurs.</p>
          </div>
        {:else}
          <div class="guide-list">
            {#each guides as guide (guide.id)}
              <article class="guide-card dynamic-card">
                <div class="votes">
                  <button
                    class:active={guide.user_vote === 'up'}
                    aria-label="Voter pour"
                    onclick={() => vote(guide, 'up')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 15 7-7 7 7" /></svg>
                  </button>
                  <span class="score">{guide.upvotes - guide.downvotes}</span>
                  <button
                    class:active={guide.user_vote === 'down'}
                    aria-label="Voter contre"
                    onclick={() => vote(guide, 'down')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 9-7 7-7-7" /></svg>
                  </button>
                </div>

                <div class="guide-body">
                  <header class="guide-head">
                    <div class="avatar">
                      {#if guide.author_avatar}
                        <img src={guide.author_avatar} alt="" />
                      {:else}
                        {guide.author_username.slice(0, 1).toUpperCase()}
                      {/if}
                    </div>
                    <div>
                      <p class="author">{guide.author_username}</p>
                      <p class="when">{formatRelativeDate(guide.created_at)}</p>
                    </div>
                    <div class="guide-tags">
                      {#if guide.ai_generated || guide.content_type === 'ai'}
                        <span class="tag ai">IA</span>
                      {/if}
                      {#if guide.verified}
                        <span class="tag verified">Vérifié</span>
                      {/if}
                    </div>
                  </header>

                  <p class="guide-content">{guide.content_md}</p>

                  {#if guide.video_url}
                    <a class="video" href={guide.video_url} target="_blank" rel="noreferrer">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m10 8 6 4-6 4V8Z M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                      Voir la vidéo
                    </a>
                  {/if}

                  <footer class="guide-foot">
                    <span>{guide.upvotes} utile{guide.upvotes > 1 ? 's' : ''}</span>
                    <span>{guide.downvotes} pas utile</span>
                  </footer>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {:else}
      <section class="comments-section">
        <div class="section-head">
          <div>
            <h2>Discussion</h2>
            <p class="section-sub">Pose une question ou aide un autre chasseur.</p>
          </div>
        </div>

        <div class="composer dynamic-card">
          <textarea
            bind:value={commentDraft}
            rows="3"
            placeholder="Partage ton retour, ta question…"
            disabled={savingComment}
          ></textarea>
          <div class="composer-foot">
            <span class="hint">{commentDraft.trim().length} caractères</span>
            <button class="btn-glossy" onclick={submitComment} disabled={savingComment}>
              {savingComment ? 'Envoi…' : 'Publier'}
            </button>
          </div>
        </div>

        {#if comments.length === 0}
          <div class="empty dynamic-card">
            <div class="empty-ico">💬</div>
            <h3>Aucun message</h3>
            <p>Lance la discussion sur ce succès.</p>
          </div>
        {:else}
          <div class="comment-list">
            {#each comments as comment (comment.id)}
              <article class="comment dynamic-card">
                <div class="avatar">
                  {#if comment.avatar_url}
                    <img src={comment.avatar_url} alt="" />
                  {:else}
                    {comment.username.slice(0, 1).toUpperCase()}
                  {/if}
                </div>
                <div class="comment-body">
                  <header>
                    <p class="author">{comment.username}</p>
                    <p class="when">{formatRelativeDate(comment.created_at)}</p>
                  </header>
                  <p class="comment-content">{comment.content_md}</p>

                  <div class="reactions">
                    {#each Object.entries(reactionEmoji) as [type, emoji] (type)}
                      <button
                        class="reaction"
                        class:active={comment.user_reaction === type}
                        aria-label={reactionLabel[type as keyof CommentReactions]}
                        title={reactionLabel[type as keyof CommentReactions]}
                        onclick={() => react(comment, type as keyof CommentReactions)}
                      >
                        <span>{emoji}</span>
                        {comment.reactions[type as keyof CommentReactions] || ''}
                      </button>
                    {/each}
                    <button
                      class="reply-btn"
                      onclick={() => (replyingTo = replyingTo === comment.id ? null : comment.id)}
                    >
                      Répondre
                    </button>
                  </div>

                  {#if replyingTo === comment.id}
                    <div class="reply-composer">
                      <textarea bind:value={replyDraft} rows="2" placeholder="Ta réponse…"></textarea>
                      <button class="btn-glossy" onclick={() => submitReply(comment)} disabled={savingReply}>
                        {savingReply ? 'Envoi…' : 'Répondre'}
                      </button>
                    </div>
                  {/if}

                  {#if comment.replies?.length}
                    <div class="replies">
                      {#each comment.replies as reply (reply.id)}
                        <div class="reply">
                          <div class="avatar small">
                            {#if reply.avatar_url}
                              <img src={reply.avatar_url} alt="" />
                            {:else}
                              {reply.username.slice(0, 1).toUpperCase()}
                            {/if}
                          </div>
                          <div>
                            <header>
                              <p class="author">{reply.username}</p>
                              <p class="when">{formatRelativeDate(reply.created_at)}</p>
                            </header>
                            <p class="comment-content">{reply.content_md}</p>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
  }

  .crumbs a {
    transition: color 0.15s ease;
  }

  .crumbs a:hover {
    color: hsl(var(--primary));
  }

  .crumbs .current {
    color: hsl(var(--foreground));
  }

  /* Hero */
  .hero {
    position: relative;
    overflow: hidden;
    border: 1px solid hsl(var(--border) / 80%);
    border-radius: 1.25rem;
    background: linear-gradient(180deg, hsl(var(--card)), hsl(var(--card) / 60%));
    box-shadow:
      0 1px 0 0 rgb(255 255 255 / 4%) inset,
      0 8px 24px -12px rgb(0 0 0 / 60%);
  }

  .hero-bg {
    position: absolute;
    inset: 0;
  }

  .hero-bg img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.2;
    filter: blur(1px);
  }

  .hero-veil {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, hsl(var(--card) / 92%), hsl(var(--card) / 75%));
  }

  .hero-body {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
  }

  @media (min-width: 900px) {
    .hero-body {
      flex-direction: row;
      align-items: center;
      padding: 1.75rem;
    }
  }

  .icon-shell {
    position: relative;
    width: 6rem;
    height: 6rem;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 1px solid hsl(var(--border));
    border-radius: 1.1rem;
    background: hsl(var(--secondary));
    box-shadow: 0 12px 30px -18px rgb(0 0 0 / 80%);
  }

  .icon-shell img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  .icon-shell.locked img {
    filter: grayscale(1) brightness(0.7);
  }

  .icon-shell.platinum {
    border-color: hsl(var(--trophy-platinum) / 45%);
    box-shadow: 0 0 30px -6px hsl(var(--trophy-platinum) / 35%);
  }

  .icon-shell.gold {
    border-color: hsl(var(--trophy-gold) / 45%);
    box-shadow: 0 0 30px -6px hsl(var(--trophy-gold) / 35%);
  }

  .icon-shell.silver {
    border-color: hsl(var(--trophy-silver) / 45%);
  }

  .icon-shell.bronze {
    border-color: hsl(var(--trophy-bronze) / 45%);
  }

  .icon-fallback {
    font-size: 2.5rem;
  }

  .check {
    position: absolute;
    right: -0.4rem;
    bottom: -0.4rem;
    width: 1.8rem;
    height: 1.8rem;
    display: grid;
    place-items: center;
    border: 3px solid hsl(var(--card));
    border-radius: 9999px;
    background: hsl(142 71% 45%);
    color: white;
  }

  .check svg {
    width: 0.9rem;
    height: 0.9rem;
  }

  .hero-info {
    flex: 1;
    min-width: 0;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }

  .trophy-chip,
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: capitalize;
    letter-spacing: 0.03em;
    color: hsl(var(--muted-foreground));
  }

  .trophy-chip svg {
    width: 0.7rem;
    height: 0.7rem;
  }

  .trophy-chip.platinum {
    color: hsl(var(--trophy-platinum));
    border-color: hsl(var(--trophy-platinum) / 40%);
    background: hsl(var(--trophy-platinum) / 10%);
  }

  .trophy-chip.gold,
  .badge.platinum {
    color: hsl(var(--trophy-gold));
    border-color: hsl(var(--trophy-gold) / 40%);
    background: hsl(var(--trophy-gold) / 10%);
  }

  .trophy-chip.silver {
    color: hsl(var(--trophy-silver));
    border-color: hsl(var(--trophy-silver) / 40%);
    background: hsl(var(--trophy-silver) / 10%);
  }

  .trophy-chip.bronze {
    color: hsl(var(--trophy-bronze));
    border-color: hsl(var(--trophy-bronze) / 40%);
    background: hsl(var(--trophy-bronze) / 10%);
  }

  h1 {
    font-size: clamp(1.5rem, 3vw, 2rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  .desc {
    max-width: 56ch;
    margin-top: 0.5rem;
    font-size: 0.9rem;
    line-height: 1.6;
    color: hsl(var(--muted-foreground));
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.9rem;
    font-size: 0.72rem;
    color: hsl(var(--muted-foreground));
  }

  .rarity {
    padding: 0.15rem 0.5rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border));
    font-weight: 700;
  }

  .rarity.ultra-rare {
    color: hsl(var(--trophy-platinum));
    border-color: hsl(var(--trophy-platinum) / 40%);
    background: hsl(var(--trophy-platinum) / 10%);
  }

  .rarity.rare {
    color: hsl(var(--trophy-gold));
    border-color: hsl(var(--trophy-gold) / 40%);
    background: hsl(var(--trophy-gold) / 10%);
  }

  .rarity.uncommon {
    color: hsl(142 71% 55%);
    border-color: hsl(142 71% 45% / 40%);
    background: hsl(142 71% 45% / 10%);
  }

  .dot {
    width: 3px;
    height: 3px;
    border-radius: 9999px;
    background: hsl(var(--muted-foreground) / 50%);
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
  }

  .unlocked-date {
    color: hsl(142 71% 60%);
  }

  .game-link {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.8rem;
    border: 1px solid hsl(var(--border));
    border-radius: 0.85rem;
    background: hsl(var(--background) / 40%);
    transition: border-color 0.15s ease;
  }

  .game-link:hover {
    border-color: hsl(var(--primary) / 40%);
  }

  .game-link img {
    width: 2rem;
    height: 2.6rem;
    object-fit: cover;
    border-radius: 0.35rem;
  }

  .game-link small {
    display: block;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: hsl(var(--muted-foreground));
  }

  .game-link strong {
    display: block;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8rem;
  }

  .game-link svg {
    width: 0.9rem;
    height: 0.9rem;
    color: hsl(var(--muted-foreground));
  }

  /* Stats */
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  @media (min-width: 900px) {
    .stats {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .stat {
    padding: 0.9rem 1rem;
  }

  .label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: hsl(var(--muted-foreground));
  }

  .value {
    margin-top: 0.35rem;
    font-size: 1.5rem;
  }

  .value.status {
    font-size: 1.15rem;
    background-image: none;
    color: hsl(var(--muted-foreground));
  }

  .value.status.done {
    color: hsl(142 71% 55%);
  }

  /* Tabs */
  .tabs-bar {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid hsl(var(--border));
  }

  .tabs-bar button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.65rem 1rem;
    border-bottom: 2px solid transparent;
    font-size: 0.85rem;
    font-weight: 700;
    color: hsl(var(--muted-foreground));
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .tabs-bar button:hover {
    color: hsl(var(--foreground));
  }

  .tabs-bar button.active {
    color: hsl(var(--primary));
    border-bottom-color: hsl(var(--primary));
  }

  .count {
    padding: 0.05rem 0.4rem;
    border-radius: 9999px;
    background: hsl(var(--secondary));
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.65rem;
  }

  .section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  .section-sub {
    margin-top: 0.2rem;
    font-size: 0.78rem;
    color: hsl(var(--muted-foreground));
  }

  .btn-glossy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    flex-shrink: 0;
    height: 2.3rem;
    padding: 0 0.95rem;
    border: none;
    border-radius: 9999px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    font-size: 0.78rem;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 8px 24px -8px hsl(var(--primary) / 60%);
  }

  .btn-glossy:disabled {
    opacity: 0.6;
  }

  .btn-glossy svg {
    width: 0.9rem;
    height: 0.9rem;
  }

  /* Composer */
  .composer {
    padding: 1rem;
    margin-bottom: 1rem;
  }

  textarea,
  input[type='url'] {
    width: 100%;
    padding: 0.7rem 0.8rem;
    border: 1px solid hsl(var(--border));
    border-radius: 0.7rem;
    background: hsl(var(--background) / 60%);
    font-family: inherit;
    font-size: 0.85rem;
    color: hsl(var(--foreground));
    resize: vertical;
  }

  input[type='url'] {
    margin-top: 0.5rem;
  }

  textarea:focus,
  input[type='url']:focus {
    outline: none;
    border-color: hsl(var(--primary) / 60%);
  }

  .composer-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.7rem;
  }

  .hint {
    font-size: 0.7rem;
    color: hsl(var(--muted-foreground));
  }

  /* Guides */
  .guide-list {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .guide-card {
    display: flex;
    gap: 0.9rem;
    padding: 1rem;
  }

  .votes {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
  }

  .votes button {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid hsl(var(--border));
    border-radius: 0.6rem;
    background: hsl(var(--background) / 50%);
    color: hsl(var(--muted-foreground));
    transition: all 0.15s ease;
  }

  .votes button svg {
    width: 0.9rem;
    height: 0.9rem;
  }

  .votes button:hover,
  .votes button.active {
    color: hsl(var(--primary));
    border-color: hsl(var(--primary) / 50%);
    background: hsl(var(--primary) / 10%);
  }

  .score {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .guide-body {
    flex: 1;
    min-width: 0;
  }

  .guide-head,
  .comment header {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .avatar {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 9999px;
    background: hsl(var(--secondary));
    font-size: 0.75rem;
    font-weight: 800;
    color: hsl(var(--primary));
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar.small {
    width: 1.6rem;
    height: 1.6rem;
    font-size: 0.65rem;
  }

  .author {
    font-size: 0.8rem;
    font-weight: 700;
  }

  .when {
    font-size: 0.65rem;
    color: hsl(var(--muted-foreground));
  }

  .guide-tags {
    display: flex;
    gap: 0.35rem;
    margin-left: auto;
  }

  .tag {
    padding: 0.1rem 0.45rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border));
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: hsl(var(--muted-foreground));
  }

  .tag.ai {
    color: hsl(var(--accent));
    border-color: hsl(var(--accent) / 40%);
    background: hsl(var(--accent) / 10%);
  }

  .tag.verified {
    color: hsl(142 71% 55%);
    border-color: hsl(142 71% 45% / 40%);
    background: hsl(142 71% 45% / 10%);
  }

  .guide-content {
    margin-top: 0.7rem;
    font-size: 0.85rem;
    line-height: 1.65;
    white-space: pre-line;
    color: hsl(var(--foreground) / 90%);
  }

  .video {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.7rem;
    padding: 0.35rem 0.65rem;
    border: 1px solid hsl(var(--border));
    border-radius: 0.6rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: hsl(var(--primary));
  }

  .video svg {
    width: 0.85rem;
    height: 0.85rem;
  }

  .guide-foot {
    display: flex;
    gap: 1rem;
    margin-top: 0.75rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.62rem;
    color: hsl(var(--muted-foreground));
  }

  /* Comments */
  .comment-list {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .comment {
    display: flex;
    gap: 0.65rem;
    padding: 1rem;
  }

  .comment-body {
    flex: 1;
    min-width: 0;
  }

  .comment-content {
    margin-top: 0.45rem;
    font-size: 0.85rem;
    line-height: 1.6;
    white-space: pre-line;
    color: hsl(var(--foreground) / 90%);
  }

  .reactions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.65rem;
  }

  .reaction,
  .reply-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.55rem;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    background: hsl(var(--background) / 50%);
    font-size: 0.68rem;
    color: hsl(var(--muted-foreground));
    transition: all 0.15s ease;
  }

  .reaction:hover,
  .reaction.active {
    border-color: hsl(var(--primary) / 50%);
    background: hsl(var(--primary) / 10%);
  }

  .reply-btn {
    margin-left: auto;
    font-weight: 700;
  }

  .reply-btn:hover {
    color: hsl(var(--primary));
    border-color: hsl(var(--primary) / 50%);
  }

  .reply-composer {
    margin-top: 0.65rem;
  }

  .reply-composer textarea {
    font-size: 0.8rem;
  }

  .reply-composer .btn-glossy {
    margin-top: 0.45rem;
    height: 2rem;
    font-size: 0.72rem;
  }

  .replies {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.85rem;
    padding-left: 0.85rem;
    border-left: 2px solid hsl(var(--border));
  }

  .reply {
    display: flex;
    gap: 0.55rem;
  }

  /* States */
  .empty {
    padding: 2rem 1rem;
    text-align: center;
  }

  .empty-ico {
    font-size: 1.8rem;
  }

  .empty h3 {
    margin-top: 0.5rem;
    font-size: 1rem;
    font-weight: 700;
  }

  .empty p {
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: hsl(var(--muted-foreground));
  }

  .notfound {
    padding: 2rem;
    text-align: center;
  }

  .notfound h2 {
    font-size: 1.25rem;
  }

  .notfound p {
    margin: 0.5rem 0 1rem;
    font-size: 0.85rem;
    color: hsl(var(--muted-foreground));
  }

  .skeleton-hero {
    height: 16rem;
    border-radius: 1.25rem;
    background: hsl(var(--secondary));
    animation: pulse 1.6s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 0.8;
    }
  }
</style>
