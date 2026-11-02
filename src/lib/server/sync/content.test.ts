import { describe, expect, it } from 'vitest';
import { familyKey } from '../family';
import { episodeKey } from './content';

describe('version Steam d’un jeu console', () => {
  it('reconnaît un épisode écrit en chiffres romains', () => {
    const key = (name: string) => episodeKey(familyKey(name));
    expect(key('Assassin’s Creed II™')).toBe(key("Assassin's Creed 2"));
    expect(key('Final Fantasy VII')).toBe(key('FINAL FANTASY 7'));
    expect(key('Assassin’s Creed II™')).not.toBe(key("Assassin's Creed III"));
  });
});
