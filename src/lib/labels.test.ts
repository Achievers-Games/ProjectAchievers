import { describe, expect, it } from 'vitest';
import { getLocale } from '$lib/paraglide/runtime';
import { RARITY_STEPS } from './collection';
import {
  editionLabel,
  formatDate,
  formatNumber,
  formatPercent,
  formatRarity,
  formatRelative,
  syncErrorText,
  tierLabel,
  tierRule,
  trophyLabel,
} from './labels';

describe('libellés de plateforme', () => {
  it('préfère la console du jeu quand la version en a une', () => {
    expect(editionLabel({ platform: 'PSN', console: 'PS5' })).toBe('PS5');
    expect(editionLabel({ platform: 'PSN', console: null })).toBe('PlayStation');
    expect(editionLabel({ platform: 'STEAM' })).toBe('Steam');
  });
});

describe('niveaux et trophées', () => {
  it('nomme chaque niveau et retombe sur le bronze pour un niveau inconnu', () => {
    const names = [1, 2, 3, 4, 5, 6].map(tierLabel);
    expect(new Set(names).size).toBe(6);
    expect(tierLabel(99)).toBe(tierLabel(1));
  });

  it('donne un nom à chaque type de trophée', () => {
    for (const type of ['PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'ACHIEVEMENT'] as const) {
      expect(trophyLabel(type)).not.toBe('');
    }
  });

  it('lit la règle d’un niveau depuis les seuils de rareté', () => {
    // La règle arrondit à une décimale, comme la rareté affichée sur une carte.
    const rule = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });
    const percent = (value: number) => rule.format(value);
    expect(tierRule(1)).toContain(percent(RARITY_STEPS[0]!));
    expect(tierRule(3)).toContain(percent(RARITY_STEPS[1]!));
    expect(tierRule(3)).toContain(percent(RARITY_STEPS[2]!));
    expect(new Set([tierRule(1), tierRule(3), tierRule(6)]).size).toBe(3);
  });
});

describe('erreurs de synchronisation', () => {
  it('traduit un code connu et laisse un code inconnu au message générique', () => {
    expect(syncErrorText(null)).toBeNull();
    expect(syncErrorText(undefined)).toBeNull();
    const known = syncErrorText('sync_steam_private');
    expect(known).not.toBe('');
    expect(syncErrorText('code_inconnu')).not.toBe(known);
    expect(syncErrorText('code_inconnu')).not.toBe('');
  });
});

describe('formats', () => {
  it('groupe les milliers et garde une décimale pour une rareté', () => {
    expect(formatNumber(1234567)).toContain('1');
    expect(formatNumber(1234567)).not.toBe(formatNumber(12));
    expect(formatRarity(3)).toContain('3');
    expect(formatRarity(3.44)).toMatch(/3[.,]4/);
  });

  it('affiche un pourcentage entier', () => {
    expect(formatPercent(42.6)).toContain('43');
    expect(formatPercent(42.6)).toContain('%');
  });

  it('formate une date', () => {
    expect(formatDate('2024-03-05T10:00:00Z')).not.toBe('');
    expect(formatDate(new Date('2024-03-05T10:00:00Z'))).not.toBe('');
  });

  it('choisit la bonne unité relative', () => {
    const now = Date.UTC(2026, 0, 15, 12);
    const at = (ms: number) => new Date(now - ms);
    const result = [
      at(0),
      at(30_000),
      at(3_600_000),
      at(86_400_000),
      at(2_592_000),
      at(31 * 86_400_000),
    ].map((date) => formatRelative(date, now));
    expect(result[0]).not.toBe(result[2]);
    expect(result[2]).not.toBe(result[3]);
    expect(result[5]).not.toBe(result[4]);
    expect(new Set(result).size).toBeGreaterThan(3);
    expect(formatRelative(new Date(now - 3_600_000).toISOString(), now)).toBe(result[2]);
  });
});
