import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { censor, isProfane } from './profanity';

describe('censor', () => {
  it('masque un mot grossier en gardant sa longueur', () => {
    expect(censor('Quel FUCKING boss')).toBe('Quel ******* boss');
    expect(censor('espèce de connard !')).toBe('espèce de ******* !');
  });

  it('reconnaît les accents et les autres alphabets', () => {
    expect(censor('un enculé')).toBe('un ******');
    expect(censor('un encule')).toBe('un ******');
    expect(censor('ты сука')).toBe('ты ****');
    expect(censor('你这个傻逼')).toBe('你这个**');
  });

  it('voit à travers les lettres répétées, remplacées ou séparées', () => {
    expect(censor('espèce de connnnard')).toBe('espèce de *********');
    expect(censor('CONNAAARD !')).toBe('********* !');
    expect(censor('un conard')).toBe('un ******');
    expect(censor('c0nnard')).toBe('*******');
    expect(censor('c.o.n.n.a.r.d')).toBe('*************');
    expect(censor('c o n n a r d')).toBe('*************');
    expect(censor('sh1t')).toBe('****');
    expect(censor('putaiiiin de boss')).toBe('********* de boss');
    expect(censor('un cоnnard')).toBe('un *******');
  });

  it('laisse les mots ordinaires tranquilles', () => {
    for (const text of [
      'un trésor unique, niquel',
      'con mucho gusto',
      'a mosquito bite',
      'the assassin computer',
      'Matsushita, Scunthorpe',
      'カスタム 牛奶',
      'je suis en retard',
      'une balade pédestre, un putois',
      'conocer la Vergangenheit',
      'ni que toi ni que moi',
      'a b c d e',
    ]) {
      expect(censor(text)).toBe(text);
    }
  });

  it('ne touche à aucun texte du site', () => {
    for (const locale of ['fr', 'en', 'de', 'es', 'pt-BR', 'ru', 'ja', 'zh-CN']) {
      const texts = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')) as object;
      const hit = Object.values(texts)
        .filter((text): text is string => typeof text === 'string')
        .filter((text) => censor(text, locale) !== text);
      expect(hit).toEqual([]);
    }
  });

  it('garde les nombres seuls', () => {
    expect(censor('455 points', 'en')).toBe('455 points');
  });
});

describe('filtre par langue', () => {
  it('ne masque un mot ambigu que dans sa langue', () => {
    expect(censor('espèce de con', 'fr')).toBe('espèce de ***');
    expect(censor('con mucho gusto', 'es')).toBe('con mucho gusto');
    expect(censor('a mosquito bite', 'en')).toBe('a mosquito bite');
    expect(censor('une grosse bite', 'fr')).toBe('une grosse ****');
    expect(censor('バカだな', 'ja')).toBe('**だな');
  });

  it('garde le filtre commun dans toutes les langues', () => {
    expect(censor('what the fuck', 'fr')).toBe('what the ****');
    expect(censor('putain', 'ja')).toBe('******');
  });

  it('applique aussi la langue aux noms', () => {
    expect(isProfane('Le Con', 'fr')).toBe(true);
    expect(isProfane('Con Amor', 'es')).toBe(false);
  });
});

describe('isProfane', () => {
  it('refuse les noms déguisés', () => {
    for (const name of ['sh1t', 'F.U.C.K', 'xXfuckerXx', 'la salope 2000', 'p u t a i n']) {
      expect(isProfane(name)).toBe(true);
    }
  });

  it('accepte les noms ordinaires', () => {
    for (const name of ['Alyxiel9389', 'Les Chasseurs', 'Connor', 'Matsushita', 'Basic Rem']) {
      expect(isProfane(name)).toBe(false);
    }
  });
});
