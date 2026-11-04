import { describe, expect, it } from 'vitest';
import { compareAchievements, compareBucket } from './compare';

const row = (id: string, mine: boolean, masked = false) => ({
  id,
  masked,
  unlockedAt: mine ? new Date('2026-01-01') : null,
});

describe('comparaison succès par succès', () => {
  it('range chaque succès dans les quatre états', () => {
    const theirs = new Set(['common', 'theirs']);
    expect(compareBucket(row('common', true), theirs)).toBe('common');
    expect(compareBucket(row('mine', true), theirs)).toBe('mine');
    expect(compareBucket(row('theirs', false), theirs)).toBe('theirs');
    expect(compareBucket(row('neither', false), theirs)).toBe('neither');
  });

  it('compte les états et ne montre que les succès visibles de l’autre', () => {
    const achievements = [row('a', true), row('b', false), row('c', true), row('d', false)];
    expect(compareAchievements(achievements, ['a', 'b'])).toEqual({
      visible: ['a', 'b'],
      counts: { common: 1, mine: 1, theirs: 1, neither: 1 },
    });
  });

  it('ne laisse pas fuiter un succès masqué, même débloqué par l’autre', () => {
    const hidden = row('secret', false, true);
    const result = compareAchievements([hidden], ['secret']);

    expect(compareBucket(hidden, new Set(['secret']))).toBe('neither');
    expect(result.visible).toEqual([]);
    expect(result.counts).toEqual({ common: 0, mine: 0, theirs: 0, neither: 1 });
  });

  it('le montre une fois révélé', () => {
    const revealed = row('secret', false);
    const result = compareAchievements([revealed], ['secret']);

    expect(result.visible).toEqual(['secret']);
    expect(result.counts).toEqual({ common: 0, mine: 0, theirs: 1, neither: 0 });
  });
});
