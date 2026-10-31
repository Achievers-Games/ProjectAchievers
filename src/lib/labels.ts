import type { Platform, Provider, TrophyType } from '@prisma/client';
import { m } from '$lib/paraglide/messages';
import { getLocale, type Locale } from '$lib/paraglide/runtime';

/** Chaque langue est écrite dans sa propre langue : le visiteur doit pouvoir la retrouver. */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  'zh-CN': '简体中文',
  ja: '日本語',
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  STEAM: 'Steam',
  DISCORD: 'Discord',
  PSN: 'PlayStation',
  XBOX: 'Xbox',
  GOOGLE: 'Google',
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  STEAM: 'Steam',
  PSN: 'PlayStation',
  XBOX: 'Xbox',
};

const TROPHY_LABELS: Record<TrophyType, () => string> = {
  PLATINUM: m.trophy_platinum,
  GOLD: m.trophy_gold,
  SILVER: m.trophy_silver,
  BRONZE: m.trophy_bronze,
  ACHIEVEMENT: m.trophy_achievement,
};
export const trophyLabel = (type: TrophyType) => TROPHY_LABELS[type]();

const TIER_LABELS: Record<number, () => string> = {
  1: m.tier_gold,
  2: m.tier_platinum,
  3: m.tier_prismatic,
  4: m.tier_legendary,
};
export const tierLabel = (tier: number) => (TIER_LABELS[tier] ?? m.tier_gold)();

/** Les erreurs de synchronisation sont stockées par code : chacun les lit dans sa langue. */
const SYNC_ERRORS: Record<string, () => string> = {
  sync_steam_private: m.sync_steam_private,
  sync_steam_achievements_private: m.sync_steam_achievements_private,
  sync_psn_private: m.sync_psn_private,
  sync_xbox_relink: m.sync_xbox_relink,
  sync_xbox_expired: m.sync_xbox_expired,
};
export const syncErrorText = (code: string | null | undefined) =>
  code ? (SYNC_ERRORS[code] ?? m.sync_failed_retry)() : null;

export const formatNumber = (value: number) => new Intl.NumberFormat(getLocale()).format(value);
export const formatDate = (value: Date | string) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(value));
export const formatPercent = (value: number) => m.percent({ value: Math.round(value) });
export const formatRarity = (value: number) =>
  new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    value,
  );

export function formatRelative(value: Date | string, now = Date.now()): string {
  const relativeFormat = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
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
  return m.just_now();
}
