<script lang="ts">
  import { siDiscord, siPlaystation, siSteam, siXbox } from 'simple-icons';

  type Brand = 'STEAM' | 'DISCORD' | 'PSN' | 'XBOX';

  let { provider, size = 16 }: { provider: Brand; size?: number } = $props();

  const icons = { STEAM: siSteam, DISCORD: siDiscord, PSN: siPlaystation, XBOX: siXbox };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d={icons[provider].path} />
</svg>
