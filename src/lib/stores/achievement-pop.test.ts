// @vitest-environment happy-dom
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { celebrateOnce, closeAllPops, dismissAllPops, popQueue, present } from './achievement-pop';

const unlock = {
  id: 'succes-1',
  title: 'Bêta',
  icon: 'https://exemple/beta.png',
  game: 'Baldur’s Gate 3',
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
      unlockId: 'succes-1',
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
});
