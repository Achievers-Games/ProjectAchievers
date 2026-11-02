<script lang="ts">
  /** `icon` : tracé game-icons.net (512 × 512) fourni par le serveur, jamais saisi par un joueur. */
  let { icon, category, unlocked }: { icon: string; category: string; unlocked: boolean } =
    $props();
</script>

<span
  class="site-badge"
  data-category={category}
  data-unlocked={unlocked || undefined}
  aria-hidden="true"
>
  <svg viewBox="0 0 512 512" width="26" height="26">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html icon}
  </svg>
</span>

<style>
  .site-badge {
    --from: 120 120 140;
    --to: 90 90 110;
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
    border-radius: 9999px;
    background: rgb(var(--line));
    color: rgb(var(--muted));
    filter: grayscale(1);
  }

  .site-badge[data-unlocked] {
    background: linear-gradient(135deg, rgb(var(--from)), rgb(var(--to)));
    color: white;
    filter: none;
    box-shadow: 0 4px 14px rgb(var(--from) / 0.35);
  }

  [data-category='start'] {
    --from: 56 189 248;
    --to: 99 102 241;
  }
  [data-category='cards'] {
    --from: 139 108 255;
    --to: 236 92 172;
  }
  [data-category='volume'] {
    --from: 251 146 60;
    --to: 239 68 68;
  }
  [data-category='rarity'] {
    --from: 244 63 94;
    --to: 168 85 247;
  }
  [data-category='time'] {
    --from: 45 212 191;
    --to: 14 116 144;
  }
  [data-category='habits'] {
    --from: 250 204 21;
    --to: 217 119 6;
  }
  [data-category='social'] {
    --from: 74 222 128;
    --to: 22 163 74;
  }
  [data-category='season'] {
    --from: 247 196 72;
    --to: 205 139 78;
  }
  [data-category='event'] {
    --from: 34 211 238;
    --to: 59 130 246;
  }
  [data-category='secret'] {
    --from: 192 132 252;
    --to: 76 29 149;
  }
</style>
