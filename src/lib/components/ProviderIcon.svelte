<script lang="ts">
  import { faXbox } from '@fortawesome/free-brands-svg-icons';
  import { siDiscord, siPlaystation, siSteam } from 'simple-icons';

  type Brand = 'STEAM' | 'DISCORD' | 'PSN' | 'XBOX';

  let { provider, size = 16 }: { provider: Brand; size?: number } = $props();

  const [xboxWidth, xboxHeight, , , xboxPath] = faXbox.icon;
  const icons: Record<Brand, { viewBox: string; path: string }> = {
    STEAM: { viewBox: '0 0 24 24', path: siSteam.path },
    DISCORD: { viewBox: '0 0 24 24', path: siDiscord.path },
    PSN: { viewBox: '0 0 24 24', path: siPlaystation.path },
    XBOX: { viewBox: `0 0 ${xboxWidth} ${xboxHeight}`, path: String(xboxPath) },
  };
</script>

<svg
  width={size}
  height={size}
  viewBox={icons[provider].viewBox}
  fill="currentColor"
  aria-hidden="true"
>
  <path d={icons[provider].path} />
</svg>
