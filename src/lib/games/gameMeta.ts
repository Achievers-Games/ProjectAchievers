// Helpers partagés pour les composants de jeux (lib layout Svelte).
import { formatRelativeDate } from '@/lib/utils';

export function relativeDate(timestamp: number | null): string {
  return formatRelativeDate(timestamp);
}

export function platformColor(platform: string): string {
  switch (platform) {
    case 'steam':
      return 'steam';
    case 'psn':
      return 'psn';
    case 'xbox':
      return 'xbox';
    default:
      return 'steam';
  }
}
