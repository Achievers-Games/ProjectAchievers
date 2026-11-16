<script lang="ts">
  import { cssArt, SHARP_WIDTH } from '#lib/art';

  /**
   * Une grande image derrière la page. Sur un profil elle reste vive ; ailleurs (`soft`), un
   * voile aux couleurs du thème l'atténue pour que la page se lise comme d'habitude.
   */
  let {
    images,
    motion = null,
    soft = false,
    fit = 'band',
  }: {
    images: string[];
    /** Un fond Steam animé : la vidéo joue par-dessus l'image fixe. */
    motion?: string | null;
    soft?: boolean;
    /**
     * `cover` : un fond fait pour tout l'écran (fond de profil Steam). `band` : une image de jeu,
     * en bandeau en haut de la page à sa vraie taille, qui se fond dans le fond de la page.
     */
    fit?: 'cover' | 'band';
  } = $props();

  /**
   * Sans grande image, l'en-tête du jeu étiré serait pixelisé : on le floute en ambiance. Le
   * navigateur le sait en chargeant la première image ; d'ici là, les couches CSS s'en chargent.
   */
  let blurred = $state<string | null>(null);

  $effect(() => {
    blurred = null;
    if (fit !== 'band' || !images.length) return;
    const fallback = images.at(-1) ?? null;
    const probe = new Image();
    let alive = true;
    probe.onload = () => {
      if (alive && probe.naturalWidth < SHARP_WIDTH) blurred = fallback;
    };
    probe.onerror = () => {
      if (alive) blurred = fallback;
    };
    probe.src = images[0];
    return () => {
      alive = false;
    };
  });
</script>

<div
  class="page-backdrop"
  data-soft={soft ? '' : undefined}
  data-fit={blurred ? 'blur' : fit}
  style:--art={cssArt(blurred ? [blurred] : images)}
  aria-hidden="true"
>
  {#if motion}
    <!-- Coupée si l'on préfère moins d'animations ; l'image fixe reste. -->
    <video
      class="page-backdrop-video"
      src={motion}
      poster={images[0]}
      autoplay
      muted
      loop
      playsinline
    ></video>
  {/if}
</div>
