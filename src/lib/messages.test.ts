// Les huit fichiers de traduction doivent dire exactement la même chose : mêmes clés, mêmes
// emplacements. Une clé oubliée dans une langue passe sinon inaperçue jusqu'à l'écran.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LOCALES = ['fr', 'en', 'es', 'de', 'pt-BR', 'ru', 'zh-CN', 'ja'] as const;

type File = Record<string, unknown>;

const messages = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(
      readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'),
    ) as File,
  ]),
) as Record<(typeof LOCALES)[number], File>;

const keys = (file: File) =>
  Object.keys(file)
    .filter((key) => key !== '$schema')
    .sort();

/** Une valeur est un texte, ou un tableau de variantes (pluriels) qui contient des textes. */
const texts = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(texts)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(texts)
        : [];

/**
 * Les variables qu'une traduction attend. Une variante déclare ses entrées (`input count`) et
 * peut ensuite en dériver d'autres noms (`local n = count: number`), d'où l'écart normal entre
 * `{count}` et `{n}` dans les textes.
 */
const inputs = (value: unknown): string[] => {
  if (typeof value === 'string') return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  if (Array.isArray(value)) return value.flatMap(inputs);
  if (value && typeof value === 'object') {
    const variant = value as { declarations?: string[] };
    if (Array.isArray(variant.declarations))
      return variant.declarations
        .filter((line) => line.startsWith('input '))
        .map((line) => line.slice('input '.length).split(':')[0].trim());
    return Object.values(value).flatMap(inputs);
  }
  return [];
};

const placeholders = (value: unknown) => [...new Set(inputs(value))].sort();

describe('fichiers de traduction', () => {
  it('ont les mêmes clés dans les huit langues', () => {
    const reference = keys(messages.fr);
    expect(reference.length).toBeGreaterThan(1000);
    for (const locale of LOCALES.slice(1)) expect(keys(messages[locale])).toEqual(reference);
  });

  it('gardent les mêmes emplacements dans chaque traduction', () => {
    for (const key of keys(messages.fr)) {
      const expected = placeholders(messages.fr[key]);
      for (const locale of LOCALES.slice(1)) {
        expect({ locale, key, placeholders: placeholders(messages[locale][key]) }).toEqual({
          locale,
          key,
          placeholders: expected,
        });
      }
    }
  });

  it("n'ont pas de valeur vide", () => {
    for (const locale of LOCALES)
      for (const key of keys(messages[locale]))
        expect({ locale, key, texts: texts(messages[locale][key]) }).not.toEqual({
          locale,
          key,
          texts: [],
        });
  });
});
