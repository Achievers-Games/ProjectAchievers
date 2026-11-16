import { describe, expect, it } from 'vitest';
import { baseLocale, locales, localizeUrl } from '#lib/paraglide/runtime';
import { localizedPath } from './localized-path';

const PATHS = ['/', '/jeux', '/jeux/hotline-miami', '/u/exemple', '/clans/les-acharnes'];

describe('adresse d’une page dans une langue', () => {
  it('donne la même adresse que Paraglide, pour chaque langue hors du français', () => {
    for (const path of PATHS) {
      for (const locale of locales.filter((l) => l !== baseLocale)) {
        const expected = localizeUrl(new URL(path, 'https://achievers.games'), { locale }).pathname;
        expect(localizedPath(path, locale), `${locale} ${path}`).toBe(expected);
      }
    }
  });

  it('garde le français sans préfixe', () => {
    for (const path of PATHS) expect(localizedPath(path, baseLocale)).toBe(path);
  });
});
