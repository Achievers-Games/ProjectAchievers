<script lang="ts">
  /** `icon` : tracé game-icons.net (512 × 512) fourni par le serveur, jamais saisi par un joueur. */
  let {
    icon,
    category,
    unlocked,
    level = 0,
    tier = 0,
    size = 2.5,
  }: {
    icon: string;
    category: string;
    unlocked: boolean;
    level?: number;
    /** Le niveau du dernier palier obtenu, de Bronze (1) à Légendaire (6) ; 0 sans palier. */
    tier?: number;
    size?: number;
  } = $props();
</script>

<span
  class="site-badge"
  data-category={category}
  data-unlocked={unlocked || undefined}
  data-level={level || undefined}
  data-tier={tier || undefined}
  style:--size="{size}rem"
  aria-hidden="true"
>
  <svg viewBox="0 0 512 512" width="65%" height="65%">
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
    width: var(--size);
    height: var(--size);
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

  /* Un succès à paliers prend le métal du dernier palier obtenu, comme sa carte : la palette
     vient de `[data-tier]` dans app.css, de Bronze à Légendaire. */
  .site-badge[data-unlocked][data-tier] {
    background: var(--tier-badge);
    color: var(--tier-badge-ink);
    box-shadow: 0 4px 14px rgb(var(--tier-glow) / 0.45);
  }
  .site-badge[data-unlocked][data-tier='5'] {
    background-size: 300% 300%;
    animation: tier-shift 5s linear infinite alternate;
  }
  .site-badge[data-unlocked][data-tier='6'] {
    animation: tier-pulse 1.8s ease-in-out infinite alternate;
  }
  @media (prefers-reduced-motion: reduce) {
    .site-badge[data-tier] {
      animation: none;
    }
  }

  /* Les paliers d'un genre : bronze, argent, or. */
  .site-badge[data-level] {
    outline: 2px solid rgb(var(--ring) / 0.45);
    outline-offset: 2px;
  }
  .site-badge[data-unlocked][data-level] {
    outline-color: rgb(var(--ring));
  }
  [data-level='1'] {
    --ring: var(--bronze);
  }
  [data-level='2'] {
    --ring: var(--silver);
  }
  [data-level='3'] {
    --ring: var(--gold);
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
  [data-category='friends'] {
    --from: 244 114 182;
    --to: 190 24 93;
  }
  [data-category='clan'] {
    --from: 129 140 248;
    --to: 67 56 202;
  }
  [data-category='genres'] {
    --from: 251 113 133;
    --to: 234 88 12;
  }
  [data-category='themes'] {
    --from: 52 211 153;
    --to: 8 145 178;
  }
  [data-category='secret'] {
    --from: 192 132 252;
    --to: 76 29 149;
  }
</style>
