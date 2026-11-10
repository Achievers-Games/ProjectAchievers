<script lang="ts">
  import { page } from '$app/state';

  interface Props {
    /** Titre complet de l'onglet, déjà suivi du nom du site si besoin. */
    title: string;
    description?: string | null;
    /** Titre du partage : par défaut celui de l'onglet. */
    shareTitle?: string;
    shareDescription?: string | null;
    /** Chemin de l'adresse canonique : par défaut la page sans ses paramètres. */
    path?: string;
    image?: string | null;
    type?: 'website' | 'article' | 'profile';
    /** Données structurées schema.org, lues par les moteurs pour les résultats enrichis. */
    jsonLd?: Record<string, unknown> | null;
    /** Page à ne pas indexer, comme un succès caché qui ne montre rien. */
    noindex?: boolean;
  }

  let {
    title,
    description = null,
    shareTitle,
    shareDescription,
    path,
    image = null,
    type = 'website',
    jsonLd = null,
    noindex = false,
  }: Props = $props();

  // Les moteurs et les aperçus de liens veulent des adresses complètes, jamais relatives.
  const absolute = (url: string) => new URL(url, page.url.origin).href;
  const canonical = $derived(absolute(path ?? page.url.pathname));
  const picture = $derived(image ? absolute(image) : null);
  const summary = $derived(shareDescription ?? description);

  // `<` échappé : un texte saisi par un joueur ne peut pas refermer la balise du script.
  const structured = $derived(
    jsonLd
      ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...jsonLd }).replace(/</g, '\\u003c')}</` +
          'script>'
      : '',
  );
</script>

<svelte:head>
  <title>{title}</title>
  {#if description}<meta name="description" content={description} />{/if}
  {#if noindex}<meta name="robots" content="noindex" />{/if}
  <link rel="canonical" href={canonical} />
  <meta property="og:type" content={type} />
  <meta property="og:url" content={canonical} />
  <meta property="og:title" content={shareTitle ?? title} />
  {#if summary}<meta property="og:description" content={summary} />{/if}
  {#if picture}<meta property="og:image" content={picture} />{/if}
  <meta name="twitter:card" content={picture ? 'summary_large_image' : 'summary'} />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON sérialisé et échappé ci-dessus -->
  {@html structured}
</svelte:head>
