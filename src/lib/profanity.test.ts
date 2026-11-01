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

  it('laisse les mots ordinaires tranquilles', () => {
    for (const text of [
      'un trésor unique, niquel',
      'con mucho gusto',
      'a mosquito bite',
      'the assassin computer',
      'Matsushita, Scunthorpe',
      'カスタム 牛奶',
    ]) {
      expect(censor(text)).toBe(text);
    }
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
