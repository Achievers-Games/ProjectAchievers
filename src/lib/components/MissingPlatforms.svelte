<script lang="ts">
  import type { Platform } from '@prisma/client';
  import { m } from '$lib/paraglide/messages';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import { PLATFORM_LABELS } from '$lib/labels';

  let { platforms }: { platforms: Platform[] } = $props();
</script>

{#if platforms.length}
  <div class="flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="missing-platforms">
    <p>{m.platforms_missing()}</p>
    {#each platforms as platform (platform)}
      <a href={`/compte#${platform.toLowerCase()}`} class="btn gap-2">
        <ProviderIcon provider={platform} size={14} />
        {PLATFORM_LABELS[platform]}
      </a>
    {/each}
  </div>
{/if}
