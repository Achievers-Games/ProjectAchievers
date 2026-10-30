<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head><title>Erreur — Project Achievers</title></svelte:head>

<div class="py-16 text-center">
  <h1>{page.status === 404 ? 'Page introuvable' : 'Une erreur est survenue'}</h1>
  <p class="mt-2 text-sm text-muted">{page.error?.message}</p>
  <a href="/" class="btn mt-6">Retour à l'accueil</a>
</div>
