import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_BOOSTER,
  dailyStock,
  drawBooster,
  MYTHIQUE_PITY,
  normalKind,
  parisDay,
  type Pool,
} from './boosters';

const entry = (id: string, completion = 0) => ({ editionId: id, familyKey: id, completion });
const pool = (relief: string[], vivante: string[] = [], mythique: string[] = []): Pool => ({
  RELIEF: relief.map((id) => entry(id)),
  VIVANTE: vivante.map((id) => entry(id)),
  MYTHIQUE: mythique.map((id) => entry(id)),
});
/** Une suite de tirages fixe, répétée. */
const rolls = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('tirage d’un booster', () => {
  it('donne cinq cartes, en Relief pour un tirage moyen', () => {
    const { cards } = drawBooster('NORMAL', pool(['r'], ['v'], ['m']), 0, rolls(0.5));
    expect(cards).toHaveLength(CARDS_PER_BOOSTER);
    expect(cards.every((card) => card.kind === 'RELIEF')).toBe(true);
  });

  it('donne une Mythique sur un tirage sous son taux, et remet la garantie à zéro', () => {
    const drawn = drawBooster('NORMAL', pool(['r'], ['v'], ['m']), 100, rolls(0.0001, 0.5));
    expect(drawn.cards[0]!.kind).toBe('MYTHIQUE');
    expect(drawn.pityMythique).toBe(0);
  });

  it('garantit une Vivante dans un booster doré, sur la dernière carte', () => {
    const { cards } = drawBooster('GOLDEN', pool(['r'], ['v']), 0, rolls(0.5));
    expect(cards.map((card) => card.kind)).toEqual([
      'RELIEF',
      'RELIEF',
      'RELIEF',
      'RELIEF',
      'VIVANTE',
    ]);
  });

  it('force une Mythique à la garantie', () => {
    const drawn = drawBooster('NORMAL', pool(['r'], [], ['m']), MYTHIQUE_PITY - 1, rolls(0.5));
    expect(drawn.cards.at(-1)!.kind).toBe('MYTHIQUE');
    expect(drawn.pityMythique).toBe(0);
  });

  it('avance la garantie seulement quand une Mythique est possible', () => {
    expect(drawBooster('NORMAL', pool(['r'], [], ['m']), 3, rolls(0.5)).pityMythique).toBe(4);
    expect(drawBooster('NORMAL', pool(['r']), 3, rolls(0.5)).pityMythique).toBe(3);
  });

  it('descend d’un cran quand une rareté n’a aucun jeu, et remonte tout en bas', () => {
    const down = drawBooster('NORMAL', pool(['r']), 0, rolls(0.0001, 0.5));
    expect(down.cards[0]!.kind).toBe('RELIEF');
    const up = drawBooster('NORMAL', pool([], ['v']), 0, rolls(0.5));
    expect(up.cards.every((card) => card.kind === 'VIVANTE')).toBe(true);
  });

  it('refuse un pool vide', () => {
    expect(() => drawBooster('NORMAL', pool([]), 0, rolls(0.5))).toThrow();
  });

  it('ne répète pas une édition dans un booster tant qu’il en reste d’autres', () => {
    const { cards } = drawBooster('NORMAL', pool(['a', 'b', 'c']), 0, rolls(0.5));
    expect(new Set(cards.map((card) => card.editionId)).size).toBe(3);
  });

  it('tire plus souvent un jeu avancé', () => {
    const weighted: Pool = { RELIEF: [entry('a', 0), entry('b', 100)], VIVANTE: [], MYTHIQUE: [] };
    // Poids 1 contre 5 : un tirage à 0,5 du total tombe sur le jeu fini.
    const { cards } = drawBooster('NORMAL', weighted, 0, rolls(0.5));
    expect(cards[0]!.editionId).toBe('b');
  });
});

describe('booster doré', () => {
  it('tombe tous les dix boosters normaux', () => {
    expect(normalKind(0)).toBe('NORMAL');
    expect(normalKind(9)).toBe('GOLDEN');
    expect(normalKind(19)).toBe('GOLDEN');
  });
});

describe('booster offert chaque jour', () => {
  it('change de jour à minuit à Paris, pas à minuit UTC', () => {
    const lateEvening = new Date('2026-07-01T21:30:00Z'); // 23 h 30 à Paris
    const afterMidnight = new Date('2026-07-01T22:30:00Z'); // 0 h 30 à Paris
    expect(parisDay(afterMidnight) - parisDay(lateEvening)).toBe(1);
  });

  it('ajoute un booster par jour, jusqu’à sept', () => {
    const since = new Date('2026-07-01T10:00:00Z');
    expect(dailyStock(0, since, new Date('2026-07-01T20:00:00Z'))).toBe(0);
    expect(dailyStock(0, since, new Date('2026-07-03T10:00:00Z'))).toBe(2);
    expect(dailyStock(2, since, new Date('2026-08-01T10:00:00Z'))).toBe(7);
  });
});
