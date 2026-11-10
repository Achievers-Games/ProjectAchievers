<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  // Les polices de Lure, servies d'ici comme pour la bannière d'accueil : rien ne part chez Google.
  import '@fontsource/cinzel/latin-900.css';
  import '@fontsource-variable/bricolage-grotesque/wght.css';
  import '@fontsource-variable/figtree/wght.css';

  let {
    url,
    hours = null,
  }: {
    url: string;
    /** Le temps pour le 100 % selon Lure, déjà mis en forme ; `null` s'il est inconnu. */
    hours?: string | null;
  } = $props();

  /** D'où vient le visiteur, comme pour la bannière : Lure le lit dans ses statistiques. */
  const href = $derived.by(() => {
    const link = new URL(url);
    link.searchParams.set('utm_source', 'achievers');
    link.searchParams.set('utm_medium', 'fiche');
    return link.href;
  });
</script>

<!-- Un encart aux couleurs de Lure : on reconnaît chez qui mène le lien avant d'y aller. -->
<a {href} target="_blank" rel="noopener" class="lure-card" data-testid="lure-card">
  <span class="lure-card-brand" aria-hidden="true">
    <span class="lure-logo"><u></u><b></b><i></i></span>
    <span class="lure-wordmark">Lure</span>
  </span>
  {#if hours}
    <span class="lure-card-time">
      <span class="lure-card-label">{m.game_lure_time()}</span>
      <strong class="lure-card-value">{m.game_lure_hours({ hours })}</strong>
    </span>
  {/if}
  <span class="lure-card-cta">{m.game_lure_link()} ↗</span>
</a>
