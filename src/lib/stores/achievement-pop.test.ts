// @vitest-environment happy-dom
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  celebrate,
  celebrateOnce,
  closeAllPops,
  dismissAllPops,
  popQueue,
  present,
} from './achievement-pop';

const unlock = {
  id: 'succes-1',
  title: 'Bêta',
  icon: 'https://exemple/beta.png',
  game: 'Baldur’s Gate 3',
  slug: 'baldurs-gate-3',
};

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

/** Les identifiants envoyés au serveur, accusé par accusé. */
const acknowledged = () =>
  fetchMock.mock.calls.map((call) => {
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('/api/sync/fetes');
    return JSON.parse(init.body as string) as string[];
  });

describe('succès fêtés à la visite', () => {
  beforeEach(() => {
    localStorage.clear();
    dismissAllPops();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fête un succès à sa première annonce', () => {
    celebrateOnce([unlock]);
    expect(get(popQueue)).toHaveLength(1);
    expect(get(popQueue)[0].pop).toMatchObject({
      title: 'Bêta',
      game: 'Baldur’s Gate 3',
      image: 'https://exemple/beta.png',
      // Un clic mène au succès lui-même.
      href: '/succes/succes-1',
    });
  });

  it('ne prévient pas le serveur tant que l’annonce n’est pas montrée', () => {
    celebrateOnce([unlock]);
    expect(fetchMock).not.toHaveBeenCalled();
    // Reçu par un onglet caché, puis l'onglet se ferme : le succès revient à la visite suivante.
    dismissAllPops();
    celebrateOnce([unlock]);
    expect(get(popQueue)).toHaveLength(1);
  });

  it('accuse réception une fois l’annonce montrée', () => {
    celebrateOnce([unlock]);
    expect(present(get(popQueue)[0])).toBe(true);
    expect(acknowledged()).toEqual([['succes-1']]);
  });

  it('ne rejoue pas un succès déjà vu, même après un rechargement', () => {
    celebrateOnce([unlock]);
    present(get(popQueue)[0]);
    dismissAllPops();
    // La visite suivante : le serveur n'a peut-être pas encore reçu l'accusé.
    celebrateOnce([unlock]);
    expect(get(popQueue)).toHaveLength(0);
  });

  it('ne met pas deux fois en file le même succès', () => {
    celebrateOnce([unlock]);
    // Le flux se reconnecte et renvoie le rattrapage avant que l'annonce ne soit vue.
    celebrateOnce([unlock]);
    expect(get(popQueue)).toHaveLength(1);
  });

  it('écarte un succès qu’un autre onglet a montré entre-temps', () => {
    celebrateOnce([unlock]);
    const item = get(popQueue)[0];
    localStorage.setItem('pa_succes_vus', JSON.stringify({ 'succes-1': Date.now() }));
    expect(present(item)).toBe(false);
    expect(get(popQueue)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('compte pour vus les succès d’une pile fermée d’un coup', () => {
    celebrateOnce([unlock, { ...unlock, id: 'succes-2', title: 'Gamma' }]);
    closeAllPops();
    expect(get(popQueue)).toHaveLength(0);
    expect(acknowledged()).toEqual([['succes-1', 'succes-2']]);
  });

  it('garde le nouveau succès quand les anciens sont déjà connus', () => {
    celebrateOnce([unlock]);
    present(get(popQueue)[0]);
    dismissAllPops();
    celebrateOnce([unlock, { ...unlock, id: 'succes-2', title: 'Gamma' }]);
    expect(get(popQueue).map((item) => item.pop.title)).toEqual(['Gamma']);
  });

  it('réunit les succès d’un même jeu en une seule annonce qui mène au jeu', () => {
    celebrateOnce([
      unlock,
      { ...unlock, id: 'succes-2', title: 'Gamma' },
      { ...unlock, id: 'tunic-1', title: 'Épée', game: 'Tunic', slug: 'tunic' },
    ]);
    const pops = get(popQueue).map((item) => item.pop);
    expect(pops).toHaveLength(2);
    expect(pops[0]).toMatchObject({
      title: 'Baldur’s Gate 3',
      count: 2,
      href: '/jeux/baldurs-gate-3',
    });
    expect(pops[1]).toMatchObject({ title: 'Épée', game: 'Tunic', href: '/succes/tunic-1' });
  });

  it('accuse réception de tous les succès d’une annonce réunie', () => {
    celebrateOnce([unlock, { ...unlock, id: 'succes-2', title: 'Gamma' }]);
    expect(present(get(popQueue)[0])).toBe(true);
    expect(acknowledged()).toEqual([['succes-1', 'succes-2']]);
  });

  it('ajoute les nouveaux succès d’un jeu à son annonce en attente, pas à celle affichée', () => {
    celebrateOnce([{ ...unlock, id: 'tunic-1', title: 'Épée', game: 'Tunic', slug: 'tunic' }]);
    celebrateOnce([unlock]);
    celebrateOnce([{ ...unlock, id: 'succes-2', title: 'Gamma' }]);
    // Tunic est à l'écran ; Baldur’s Gate 3 attendait derrière et grossit.
    expect(get(popQueue).map((item) => item.pop.count ?? 1)).toEqual([1, 2]);
    celebrateOnce([{ ...unlock, id: 'tunic-2', title: 'Bouclier', game: 'Tunic', slug: 'tunic' }]);
    // Le Tunic affiché ne change pas sous les yeux du joueur : le nouveau succès attend.
    expect(get(popQueue).map((item) => item.pop.title)).toEqual([
      'Épée',
      'Baldur’s Gate 3',
      'Bouclier',
    ]);
  });

  it('fait passer les succès du site devant les jeux qui attendent', () => {
    celebrateOnce([
      unlock,
      { ...unlock, id: 'tunic-1', title: 'Épée', game: 'Tunic', slug: 'tunic' },
    ]);
    celebrate([
      {
        title: 'Fort Knox',
        icon: '',
        category: 'cards',
        level: 4,
        href: '/u/demo/succes#succes-gold_100',
      },
    ]);
    // Baldur’s Gate 3 reste à l'écran ; le succès du site passe devant Tunic.
    expect(get(popQueue).map((item) => item.pop.title)).toEqual(['Bêta', 'Fort Knox', 'Épée']);
  });
});
