import { baseLocale, isLocale, type Locale } from '#lib/paraglide/runtime';
import { parseGameGuideFile, parseGuideFile } from './curated-guides';
import { countChecklist } from './markdown';

type Edition = { locale: Locale; contentMd: string; title?: string };

// Les éditions gardent la clé du guide publié. Elles n'ajoutent ni page ni suivi séparé.
const files = import.meta.glob<string>('/src/lib/guides/locales/*/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const editions = new Map<string, Edition & { steps: number }>();

function register(key: string, edition: Edition) {
  const index = `${key}:${edition.locale}`;
  if (editions.has(index)) throw new Error(`Édition de guide en double : ${index}`);
  editions.set(index, { ...edition, steps: countChecklist(edition.contentMd) });
}

for (const [path, source] of Object.entries(files)) {
  const locale = path.split('/')[5];
  if (!isLocale(locale) || locale === baseLocale)
    throw new Error(`Langue de guide invalide : ${path}`);

  if (path.includes('/jeux/')) {
    const { platform, gameId, title, content } = parseGameGuideFile(source);
    register(`${platform}:${gameId}:JEU`, { locale, title, contentMd: content });
  } else {
    const { platform, gameId, guides } = parseGuideFile(source);
    for (const { achievementId, content } of guides) {
      register(`${platform}:${gameId}:${achievementId}`, { locale, contentMd: content });
    }
  }
}

export function guideEdition<
  T extends { curatedKey: string | null; contentMd: string; locale: string | null },
>(guide: T, locale: Locale): T | (T & Edition) {
  if (!guide.curatedKey || guide.locale === locale) return guide;
  const edition = editions.get(`${guide.curatedKey}:${locale}`);
  // Les cases enregistrées sont indexées par position sur le guide d'origine.
  if (!edition || edition.steps !== countChecklist(guide.contentMd)) return guide;
  const { locale: language, title, contentMd } = edition;
  return { ...guide, locale: language, contentMd, ...(title === undefined ? {} : { title }) };
}
