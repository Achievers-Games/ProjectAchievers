import { describe, expect, it } from 'vitest';
import hollowKnight from '#lib/guides/jeux/hollow-knight.md?raw';
import silksong from '#lib/guides/jeux/hollow-knight-silksong.md?raw';
import { parseGameGuideFile } from './curated-guides';
import { guideEdition } from './guide-editions';
import { guideTermNames } from './guide-terms';
import { countChecklist } from './guides';
import { renderGuide } from './markdown';

const original = parseGameGuideFile(silksong);
const guide = {
  id: 'silksong-guide',
  curatedKey: 'STEAM:1030300:JEU',
  title: original.title,
  contentMd: original.content,
  locale: 'fr',
  checks: [{ item: 1 }],
};

function render(locale: 'fr' | 'en' | 'es') {
  const edition = guideEdition(guide, locale);
  const html = renderGuide(edition.contentMd, guideTermNames(guide.curatedKey, edition.locale));
  return { edition, html, checks: html.match(/data-check="\d+"/g) };
}

describe('éditions des guides officiels', () => {
  it('sert une édition complète avec ses noms en jeu et le même suivi dans chaque langue', () => {
    const french = render('fr');
    const english = render('en');
    const spanish = render('es');
    expect(french.html).toContain('Clochelle');
    expect(english.html).toContain('Bellhart');
    expect(spanish.html).toContain('Campanilla');
    expect(spanish.html).toContain('Garra elongada');
    expect(spanish.html).not.toContain('{{terme:');
    expect(spanish.edition.title).toContain('Guía completa');
    expect(spanish.edition.id).toBe(guide.id);
    expect(spanish.edition.checks).toEqual(guide.checks);
    expect(french.checks).toHaveLength(51);
    expect(english.checks).toEqual(french.checks);
    expect(spanish.checks).toEqual(french.checks);
  });

  it('garde le texte source si la langue manque ou si le suivi est incompatible', () => {
    expect(guideEdition(guide, 'de')).toBe(guide);
    const revised = { ...guide, contentMd: '- [ ] Première étape' };
    expect(guideEdition(revised, 'es')).toBe(revised);
    const community = { ...guide, curatedKey: null };
    expect(guideEdition(community, 'es')).toBe(community);
  });

  it('sert aussi le parcours anglais de Hollow Knight avec toutes ses cases', () => {
    const source = parseGameGuideFile(hollowKnight);
    const edition = guideEdition(
      { curatedKey: 'STEAM:367520:JEU', contentMd: source.content, locale: 'fr' },
      'en',
    );
    expect(edition.locale).toBe('en');
    expect(edition.contentMd).toContain('Forgotten Crossroads');
    expect(countChecklist(edition.contentMd)).toBe(49);
  });
});
