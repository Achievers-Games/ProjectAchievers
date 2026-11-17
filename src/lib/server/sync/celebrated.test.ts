import { describe, expect, it } from 'vitest';
import { parseCelebratedIds } from './celebrated';

describe('accusé de réception des succès fêtés', () => {
  it('lit une liste d’identifiants', () => {
    expect(parseCelebratedIds('["a","b"]')).toEqual(['a', 'b']);
  });

  it('refuse ce qui n’est pas une liste de textes courts', () => {
    expect(parseCelebratedIds('pas du json')).toBeNull();
    expect(parseCelebratedIds('{"id":"a"}')).toBeNull();
    expect(parseCelebratedIds('[1]')).toBeNull();
    expect(parseCelebratedIds('[""]')).toBeNull();
    expect(parseCelebratedIds(JSON.stringify(['x'.repeat(65)]))).toBeNull();
    expect(
      parseCelebratedIds(JSON.stringify(Array.from({ length: 51 }, (_, i) => `${i}`))),
    ).toBeNull();
  });
});
