<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import UnlockDiscussion from '#lib/components/UnlockDiscussion.svelte';
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.thread.name ?? m.achievement_hidden()} — Achievers</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="card mx-auto max-w-3xl p-4">
  <UnlockDiscussion thread={data.thread} />
</div>
