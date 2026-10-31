<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { taglineText } from '$lib/taglines';

  const AUTOPLAY = 7_000;

  let { tagline, member }: { tagline: number; member: boolean } = $props();

  let track = $state<HTMLDivElement>();
  let active = $state(0);
  let paused = $state(false);

  const signIn = '/connexion';
  const slides = $derived([
    {
      id: 'saison',
      eyebrow: m.banner_season_label(),
      title: m.banner_season_title(),
      text: taglineText(tagline),
      href: member ? '/jeux?filtre=restants&tri=progression' : signIn,
      cta: m.banner_season_cta(),
    },
    {
      id: 'classement',
      eyebrow: m.ranking(),
      title: m.ranking_collectors(),
      text: m.ranking_rules(),
      href: '/classement',
      cta: m.ranking_full(),
    },
    {
      id: 'cadres',
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
        role="group"
        aria-roledescription="slide"
        aria-label="{index + 1} / {slides.length}"
      >
        <p class="carousel-eyebrow">{slide.eyebrow}</p>
        <h2 class="carousel-title">{slide.title}</h2>
        <p class="carousel-text" class:tagline={slide.id === 'saison'}>{slide.text}</p>
        <a href={slide.href} class="btn btn-primary mt-auto self-start">{slide.cta}</a>
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
