// @vitest-environment happy-dom
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { celebrateOnce, dismissAllPops, popQueue } from './achievement-pop';

const unlock = {
  id: 'succes-1',
  title: 'Bêta',
  icon: 'https://exemple/beta.png',
  game: 'Baldur’s Gate 3',
};

describe('succès fêtés à la visite', () => {
  beforeEach(() => {
    localStorage.clear();
    dismissAllPops();
  });

  it('fête un succès à sa première annonce', () => {
    celebrateOnce([unlock]);
    expect(get(popQueue)).toHaveLength(1);
    expect(get(popQueue)[0].pop).toMatchObject({
      title: 'Bêta',
      game: 'Baldur’s Gate 3',
      image: 'https://exemple/beta.png',
    });
  });

  it('ne rejoue pas un succès déjà fêté, même après un rechargement', () => {
    celebrateOnce([unlock]);
    dismissAllPops();
    // La visite suivante : le flux renvoie les mêmes succès récents.
    celebrateOnce([unlock]);
    expect(get(popQueue)).toHaveLength(0);
  });

  it('garde le nouveau succès quand les anciens sont déjà connus', () => {
    celebrateOnce([unlock]);
    dismissAllPops();
    celebrateOnce([unlock, { ...unlock, id: 'succes-2', title: 'Gamma' }]);
    expect(get(popQueue).map((item) => item.pop.title)).toEqual(['Gamma']);
  });
});
