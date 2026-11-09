<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.title} — Project Achievers</title>
  <meta
    name="description"
    content="L'API d'Achievers pour les sites partenaires : profils, jeux, liaison des comptes, Se connecter avec Achievers et webhooks."
  />
</svelte:head>

<!-- Le guide vient du dépôt (docs/api-partenaires.md), jamais d'un utilisateur. -->
<article class="prose-user prose-guide mx-auto max-w-3xl" lang="fr">
  <h1>{data.title}</h1>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html data.html}
</article>
