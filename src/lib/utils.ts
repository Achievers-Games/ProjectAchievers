import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatRelativeDate(timestamp: number | null): string {
  if (!timestamp) return 'Jamais';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'À l\'instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  if (hours < 24) return `Il y a ${hours}h`;
  if (days < 7) return `Il y a ${days}j`;
  return formatDate(timestamp);
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

export function getTrophyColor(type: string | null): string {
  switch (type) {
    case 'platinum': return 'trophy-platinum';
    case 'gold': return 'trophy-gold';
    case 'silver': return 'trophy-silver';
    case 'bronze': return 'trophy-bronze';
    default: return 'text-muted-foreground';
  }
}

export function getPlatformColor(platform: string): string {
  switch (platform) {
    case 'steam': return 'platform-steam';
    case 'psn': return 'platform-playstation';
    case 'xbox': return 'platform-xbox';
    default: return 'text-muted-foreground';
  }
}

export function getTrophyIcon(type: string | null): string {
  switch (type) {
    case 'platinum': return '🏆';
    case 'gold': return '🥇';
    case 'silver': return '🥈';
    case 'bronze': return '🥉';
    default: return '⭐';
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return `${text.slice(0, length)}...`;
}