import type { Platform, Provider, TrophyType } from '@prisma/client';

export const PROVIDER_LABELS: Record<Provider, string> = {
  STEAM: 'Steam',
  DISCORD: 'Discord',
  PSN: 'PlayStation',
  XBOX: 'Xbox',
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  STEAM: 'Steam',
  PSN: 'PlayStation',
  XBOX: 'Xbox',
};

export const TROPHY_LABELS: Record<TrophyType, string> = {
  PLATINUM: 'Platine',
  GOLD: 'Or',
  SILVER: 'Argent',
  BRONZE: 'Bronze',
  ACHIEVEMENT: 'Succès',
};

const number = new Intl.NumberFormat('fr-FR');
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const relativeFormat = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

export const formatNumber = (value: number) => number.format(value);
export const formatDate = (value: Date | string) => dateFormat.format(new Date(value));

export function formatRelative(value: Date | string, now = Date.now()): string {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "à l'instant";
}

export const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${formatNumber(count)} ${count > 1 ? pluralForm : singular}`;
