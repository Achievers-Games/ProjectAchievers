import { describe, expect, it } from 'vitest';
import { KEY_PATH, indexNowEnabled, indexNowKey, indexNowPayload } from './indexnow';

describe('IndexNow', () => {
  it("n'annonce que depuis le site public en production", () => {
    expect(indexNowEnabled('https://achievers.games', 'production')).toBe(true);
    expect(indexNowEnabled('https://achievers.games', 'development')).toBe(false);
    expect(indexNowEnabled('https://achievers.games', 'test')).toBe(false);
    expect(indexNowEnabled('http://achievers.games', 'production')).toBe(false);
    expect(indexNowEnabled('https://localhost:3000', 'production')).toBe(false);
    expect(indexNowEnabled('https://site.localhost', 'production')).toBe(false);
  });

  it('tire une clé stable, au format accepté par le protocole', () => {
    const key = indexNowKey('a'.repeat(64));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(indexNowKey('a'.repeat(64))).toBe(key);
    expect(indexNowKey('b'.repeat(64))).not.toBe(key);
  });

  it('envoie des adresses complètes, sans doublon', () => {
    expect(
      indexNowPayload('https://achievers.games', 'abc', ['/succes/1', '/jeux/x', '/succes/1']),
    ).toEqual({
      host: 'achievers.games',
      key: 'abc',
      keyLocation: `https://achievers.games${KEY_PATH}`,
      urlList: ['https://achievers.games/succes/1', 'https://achievers.games/jeux/x'],
    });
  });
});
