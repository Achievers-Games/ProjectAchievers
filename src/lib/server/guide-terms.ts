import { baseLocale, type Locale } from '#lib/paraglide/runtime';
import hollowKnight from './guide-terms/hollow-knight.json';
import silksong from './guide-terms/silksong.json';

type Glossary = Record<string, Partial<Record<Locale, string>>>;

const glossaries: Record<string, Glossary> = {
  'STEAM:367520': hollowKnight,
  'STEAM:1030300': silksong,
};

/** Ces libellés viennent des localisations du jeu. Sans libellé attesté, garder l'anglais. */
export function guideTermNames(curatedKey: string | null, locale: string | null = baseLocale) {
  const gameKey = curatedKey?.split(':', 2).join(':');
  const glossary = gameKey ? glossaries[gameKey] : undefined;
  return (name: string) => {
    const labels = glossary && Object.hasOwn(glossary, name) ? glossary[name] : undefined;
    return labels?.[(locale ?? baseLocale) as Locale] ?? name;
  };
}
