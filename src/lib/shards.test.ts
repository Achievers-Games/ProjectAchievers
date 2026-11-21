import { describe, expect, it } from 'vitest';
import {
  achievementPart,
  DLC_MIN_SHARDS,
  partShards,
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

describe('jeu de base et DLC', () => {
  it('range les groupes par défaut et les ensembles hors DLC dans le jeu de base', () => {
    expect(achievementPart(null)).toBe('');
    expect(achievementPart('default')).toBe('');
    expect(achievementPart('set:3')).toBe('');
    expect(achievementPart('dlc:7')).toBe('dlc:7');
    expect(achievementPart('001')).toBe('001');
  });

  it('paie un DLC au prorata de ses succès, entre le plancher et le bonus du jeu', () => {
    expect(partShards(4, '', 40, 40)).toBe(completionShards(4));
    expect(partShards(4, 'dlc:7', 20, 40)).toBe(55);
    expect(partShards(4, 'dlc:7', 1, 40)).toBe(DLC_MIN_SHARDS);
    expect(partShards(4, 'dlc:7', 80, 40)).toBe(completionShards(4));
  });
});
