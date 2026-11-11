import { describe, expect, it } from 'vitest';
import { locales, localizeUrl } from '#lib/paraglide/runtime';
import { localizedPath } from './localized-path';

describe('adresse d’une page dans une langue', () => {
  it('donne la même adresse que Paraglide, pour chaque langue', () => {
    for (const path of ['/', '/jeux', '/jeux/hotline-miami', '/u/exemple', '/clans/les-acharnes']) {
      for (const locale of locales) {
        const expected = localizeUrl(new URL(path, 'https://achievers.games'), { locale }).pathname;
        expect(localizedPath(path, locale), `${locale} ${path}`).toBe(expected);
      }
    }
  });
});
