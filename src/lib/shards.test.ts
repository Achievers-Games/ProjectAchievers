import { describe, expect, it } from 'vitest';
import {
  capGains,
  completionShards,
  GAME_SHARD_CAP,
  shardsFor,
  UNKNOWN_RARITY_SHARDS,
} from './shards';

describe('éclats d’un succès', () => {
  it('paie la rareté : plus le succès est rare, plus il rapporte', () => {
    expect(shardsFor(80)).toBe(1);
    expect(shardsFor(50)).toBe(1);
    expect(shardsFor(30)).toBe(2);
    expect(shardsFor(12)).toBe(4);
    expect(shardsFor(6)).toBe(8);
    expect(shardsFor(1)).toBe(15);
    expect(shardsFor(0.4)).toBe(30);
  });

  it('compte un taux absent ou aberrant comme un succès plutôt courant', () => {
    for (const rarity of [null, undefined, 0, -1, 140, Number.NaN]) {
      expect(shardsFor(rarity)).toBe(UNKNOWN_RARITY_SHARDS);
    }
  });
});

describe('bonus d’un jeu fini', () => {
  it('suit le niveau de la carte, du Bronze au Légendaire', () => {
    expect(completionShards(1)).toBe(20);
    expect(completionShards(6)).toBe(220);
  });

  it('prend le Bronze sans niveau, et reste dans les bornes', () => {
    expect(completionShards(null)).toBe(20);
    expect(completionShards(0)).toBe(20);
    expect(completionShards(9)).toBe(220);
  });
});

describe('plafond par jeu', () => {
  it('coupe le dernier gain au plafond et écarte ce qui dépasse', () => {
    const gains = [{ shards: 30 }, { shards: 30 }, { shards: 30 }];
    expect(capGains(gains, GAME_SHARD_CAP - 40)).toEqual([{ shards: 30 }, { shards: 10 }]);
  });

  it('ne donne plus rien une fois le plafond atteint', () => {
    expect(capGains([{ shards: 15 }], GAME_SHARD_CAP)).toEqual([]);
  });
});
