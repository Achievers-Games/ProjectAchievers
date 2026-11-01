<script lang="ts">
  import { faXbox } from '@fortawesome/free-brands-svg-icons';
  import { siDiscord, siEpicgames, siGoogle, siPlaystation, siSteam } from 'simple-icons';

  type Brand = 'STEAM' | 'DISCORD' | 'PSN' | 'XBOX' | 'GOOGLE' | 'RETRO' | 'EPIC';

  let { provider, size = 16 }: { provider: Brand; size?: number } = $props();

  const [xboxWidth, xboxHeight, , , xboxPath] = faXbox.icon;
  const icons: Record<Brand, { viewBox: string; path: string }> = {
    STEAM: { viewBox: '0 0 24 24', path: siSteam.path },
    DISCORD: { viewBox: '0 0 24 24', path: siDiscord.path },
    PSN: { viewBox: '0 0 24 24', path: siPlaystation.path },
    XBOX: { viewBox: `0 0 ${xboxWidth} ${xboxHeight}`, path: String(xboxPath) },
    GOOGLE: { viewBox: '0 0 24 24', path: siGoogle.path },
    EPIC: { viewBox: '0 0 24 24', path: siEpicgames.path },
    RETRO: {
      viewBox: '0 0 24 24',
      path: 'M6 3h12v3h3v3a4 4 0 0 1-4 4h-.5A6 6 0 0 1 13 16.9V19h3v2H8v-2h3v-2.1A6 6 0 0 1 7.5 13H7a4 4 0 0 1-4-4V6h3z',
    },
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
