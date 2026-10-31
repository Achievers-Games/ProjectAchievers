<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { formatPercent } from '$lib/labels';
  import { FRAMES } from '$lib/frames';
  import Avatar from './Avatar.svelte';
  import type { BannerGame, Collector } from '$lib/server/queries';

  const AUTOPLAY = 7_000;

  let {
    tagline,
    banners,
    avatar = null,
    avatarMotion = null,
    member,
  }: {
    tagline: string;
    banners: {
      season: BannerGame | null;
      ranking: BannerGame | null;
      leader: Collector | null;
    };
    avatar?: string | null;
    avatarMotion?: string | null;
    member: boolean;
  } = $props();

  const art = (game: BannerGame | undefined) =>
    game?.images.map((image) => `url("${encodeURI(image)}")`).join(', ');

  let track = $state<HTMLDivElement>();
  let active = $state(0);
  let paused = $state(false);

  const signIn = '/connexion';
  const slides = $derived([
    {
      id: 'saison',
      game: banners.season,
      eyebrow: m.banner_season_label(),
      title: m.banner_season_title(),
      text: tagline,
      href: '/saison',
      cta: m.banner_season_cta(),
    },
    {
      id: 'classement',
      game: banners.ranking,
      eyebrow: m.ranking(),
      title: m.ranking_collectors(),
      text: m.ranking_rules(),
      href: '/classement',
      cta: m.ranking_full(),
    },
    {
      id: 'cadres',
      game: null,
      eyebrow: m.banner_frames_label(),
      title: m.frames_title(),
      text: m.banner_frames_text(),
      href: member ? '/compte' : signIn,
      cta: m.banner_frames_cta(),
    },
  ]);

  function show(index: number) {
    if (!track) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({
      left: index * track.clientWidth,
      behavior: reduced ? 'auto' : 'smooth',
    });
  }

  const shift = (step: number) => show((active + step + slides.length) % slides.length);

  // Le défilement suit aussi le doigt : l'indicateur se recale sur ce qui est visible.
  function onScroll() {
    if (track) active = Math.round(track.scrollLeft / track.clientWidth);
  }

  $effect(() => {
    if (paused || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => shift(1), AUTOPLAY);
    return () => clearInterval(timer);
  });
</script>

<section
  class="carousel"
  aria-roledescription="carousel"
  aria-label={m.carousel_label()}
  onmouseenter={() => (paused = true)}
  onmouseleave={() => (paused = false)}
  onfocusin={() => (paused = true)}
  onfocusout={() => (paused = false)}
>
  <div class="carousel-track" bind:this={track} onscroll={onScroll}>
    {#each slides as slide, index (slide.id)}
      <article
        class="carousel-slide"
        data-slide={slide.id}
        style:--art={art(slide.game ?? undefined)}
        role="group"
        aria-roledescription="slide"
        aria-label="{index + 1} / {slides.length}"
      >
        <p class="carousel-eyebrow">{slide.eyebrow}</p>
        <h2 class="carousel-title">{slide.title}</h2>
        <p class="carousel-text" class:tagline={slide.id === 'saison'}>{slide.text}</p>
        <div class="mt-auto flex flex-wrap items-center gap-3">
          <a href={slide.href} class="btn btn-primary">{slide.cta}</a>
          {#if slide.game}
            {@const game = slide.game}
            <a href="/jeux/{game.slug}" class="carousel-game">
              {game.completion === null
                ? game.name
                : `${game.name} · ${formatPercent(game.completion)}`}
            </a>
          {/if}
        </div>
        {#if slide.id === 'classement' && banners.leader}
          {@const leader = banners.leader}
          <a href="/u/{leader.handle}" class="carousel-leader">
            <Avatar person={leader} play="always" size={96} />
            <span class="max-w-full truncate text-sm font-bold text-white">
              {leader.displayName}
            </span>
            <span class="text-xs font-semibold text-gold">
              {m.count_points({ count: leader.score })}
            </span>
          </a>
        {/if}
        {#if slide.id === 'cadres'}
          <div class="carousel-frames" aria-hidden="true">
            {#each FRAMES as frame (frame)}
              <Avatar
                name="Achievers"
                src={member ? avatar : banners.leader?.avatarUrl}
                motion={member ? avatarMotion : banners.leader?.avatarMotionUrl}
                play="always"
                {frame}
                size={56}
              />
            {/each}
          </div>
        {/if}
      </article>
    {/each}
  </div>

  <button
    type="button"
    class="carousel-arrow left-2"
    aria-label={m.carousel_prev()}
    onclick={() => shift(-1)}
  >
    <ChevronLeft size={18} aria-hidden="true" />
  </button>
  <button
    type="button"
    class="carousel-arrow right-2"
    aria-label={m.carousel_next()}
    onclick={() => shift(1)}
  >
    <ChevronRight size={18} aria-hidden="true" />
  </button>

  <div class="carousel-dots">
    {#each slides as slide, index (slide.id)}
      <button
        type="button"
        aria-label={m.carousel_go({ number: index + 1 })}
        aria-current={index === active ? 'true' : undefined}
        onclick={() => show(index)}
      ></button>
    {/each}
  </div>
</section>
