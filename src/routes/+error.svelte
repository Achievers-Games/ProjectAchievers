<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { page } from '$app/state';
</script>

<svelte:head><title>{m.error_title()} — Project Achievers</title></svelte:head>

<div class="py-16 text-center">
  <h1>{page.status === 404 ? m.not_found() : m.error_generic()}</h1>
  <p class="mt-2 text-sm text-muted">{page.error?.message}</p>
  <a href="/" class="btn mt-6">{m.back_home()}</a>
</div>
