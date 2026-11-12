import { RARITY_STEPS } from '#lib/collection';
import type { Platform, Provider, TrophyType } from '#prisma';
import { m } from '#lib/paraglide/messages';
import { getLocale, type Locale } from '#lib/paraglide/runtime';

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
  EPIC: 'Epic Games',
  BLIZZARD: 'Battle.net',
  STEAM: 'Steam',
  DISCORD: 'Discord',
  PSN: 'PlayStation',
  RETRO: 'RetroAchievements',
  XBOX: 'Xbox',
  GOOGLE: 'Google',
};

/** Les sites partenaires reliés à un compte. */
export const PARTNER_LABELS: Record<string, string> = { lure: 'Lure' };

export const partnerLabel = (partner: string) => PARTNER_LABELS[partner] ?? partner;

/** Ce qu'un site partenaire peut lire, en mots du joueur, sur la page d'accord et dans `/compte`. */
const SCOPE_LABELS: Record<string, () => string> = {
  profile: m.oauth_scope_profile,
  library: m.oauth_scope_library,
  achievements: m.oauth_scope_achievements,
};

export const scopeLabel = (scope: string) => (SCOPE_LABELS[scope] ?? (() => scope))();

export const PLATFORM_LABELS: Record<Platform, string> = {
  BLIZZARD: 'Battle.net',
  STEAM: 'Steam',
  PSN: 'PlayStation',
  RETRO: 'RetroAchievements',
  XBOX: 'Xbox',
};

/** Une version de jeu : sa console quand on la connaît (PS3, PS4/PS5…), sinon sa plateforme. */
export const editionLabel = (version: { platform: Platform; console?: string | null }) =>
  version.console ?? PLATFORM_LABELS[version.platform];

const TROPHY_LABELS: Record<TrophyType, () => string> = {
  PLATINUM: m.trophy_platinum,
  GOLD: m.trophy_gold,
  SILVER: m.trophy_silver,
  BRONZE: m.trophy_bronze,
  ACHIEVEMENT: m.trophy_achievement,
};
export const trophyLabel = (type: TrophyType) => TROPHY_LABELS[type]();

const TIER_LABELS: Record<number, () => string> = {
  1: m.tier_bronze,
  2: m.tier_silver,
  3: m.tier_gold,
  4: m.tier_diamond,
  5: m.tier_prismatic,
  6: m.tier_legendary,
};
export const tierLabel = (tier: number) => (TIER_LABELS[tier] ?? m.tier_bronze)();

/**
 * Construire un formateur `Intl` coûte cher et ces fonctions sont appelées par ligne de liste :
 * un formateur par langue et par usage suffit pour toute la session.
 */
const formats = new Map<
  string,
  Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat
>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(
  key: string,
  create: () => T,
): T {
  const id = `${getLocale()}|${key}`;
  let format = formats.get(id) as T | undefined;
  if (!format) {
    format = create();
    formats.set(id, format);
  }
  return format;
}

const numberFormat = () => cached('number', () => new Intl.NumberFormat(getLocale()));
const dateFormat = () =>
  cached('date', () => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }));
const decimalFormat = () =>
  cached(
    'decimal',
    () =>
      new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  );
const ruleFormat = () =>
  cached('rule', () => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }));
const relativeFormat = () =>
  cached('relative', () => new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }));

/** Les seuils s'appliquent à la moyenne des taux les plus rares entre plateformes. */
export function tierRule(tier: number) {
  const low = RARITY_STEPS[tier - 1];
  const high = RARITY_STEPS[tier - 2];
  const number = (value: number) => m.percent({ value: ruleFormat().format(value) });
  if (high === undefined) return m.tier_rule_above({ percent: number(low as number) });
  if (low === undefined) return m.tier_rule_below({ percent: number(high) });
  return m.tier_rule_between({ low: number(low), high: number(high) });
}

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

export const formatNumber = (value: number) => numberFormat().format(value);
export const formatDate = (value: Date | string) => dateFormat().format(new Date(value));
export const formatPercent = (value: number) => m.percent({ value: Math.round(value) });
export const formatRarity = (value: number) => decimalFormat().format(value);

export function formatRelative(value: Date | string, now = Date.now()): string {
  const format = relativeFormat();
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return m.just_now();
}
