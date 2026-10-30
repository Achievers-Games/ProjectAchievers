<script lang="ts">
  import type { TrophyType } from '@prisma/client';
  import { TROPHY_LABELS } from '$lib/labels';

  let { type }: { type: TrophyType } = $props();

  const colors: Record<TrophyType, string> = {
    PLATINUM: 'text-platinum font-semibold',
    GOLD: 'text-gold',
    SILVER: 'text-silver',
    BRONZE: 'text-bronze',
    ACHIEVEMENT: 'text-muted',
  };
</script>

<span class="text-xs font-medium {colors[type]}">{TROPHY_LABELS[type]}</span>
