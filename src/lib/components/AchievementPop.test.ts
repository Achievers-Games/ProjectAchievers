// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { celebrate, celebrateOnce, dismissAllPops } from '#lib/stores/achievement-pop';
import AchievementPop from './AchievementPop.svelte';

const pop = (title: string) => ({ title, icon: 'trophy', category: 'start', level: 2 });

afterEach(() => {
  // Un composant resté monté d'un test précédent montrerait le succès à la place du nouveau.
  cleanup();
  dismissAllPops();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('succès affiché par-dessus la page', () => {
  it('affiche le premier succès et annonce ceux qui attendent', () => {
    celebrate([pop('Premier'), pop('Deuxième')]);
    const { container } = render(AchievementPop);

    const button = container.querySelector('button.pop') as HTMLElement;
    expect(button.textContent).toContain('Premier');
    // Le compteur indique ce qui attend derrière, sans dévoiler la suite.
    expect(button.textContent).toMatch(/\+ 1/);
    // Une pile attend : la carte ne s'efface pas d'elle-même.
    expect(button.classList.contains('last')).toBe(false);
  });

  it('pose les confettis une fois pour toutes, sans tirage au hasard', () => {
    celebrate([pop('Premier')]);
    const first = render(AchievementPop);
    const before = [...first.container.querySelectorAll<HTMLElement>('.particle')].map((particle) =>
      particle.getAttribute('style'),
    );

    const second = render(AchievementPop);
    const after = [...second.container.querySelectorAll<HTMLElement>('.particle')].map((particle) =>
      particle.getAttribute('style'),
    );

    expect(before).toHaveLength(16);
    expect(after).toEqual(before);
  });

  it('passe au succès suivant au clic et se retire une fois la pile vide', async () => {
    celebrate([pop('Premier'), pop('Deuxième')]);
    const { container } = render(AchievementPop);

    (container.querySelector('button.pop') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(container.querySelector('button.pop')?.textContent).toContain('Deuxième');
    expect(container.querySelector('button.pop')?.classList.contains('last')).toBe(true);
  });

  it('attend que l’onglet soit visible pour montrer un succès et prévenir le serveur', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    let state: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);

    celebrateOnce([{ id: 'succes-1', title: 'Bêta', icon: null, game: 'Tunic', slug: 'tunic' }]);
    const { container } = render(AchievementPop);
    await tick();
    // Téléphone en veille : rien ne s'affiche, le serveur garde le succès à fêter.
    expect(container.querySelector('.pop')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(container.querySelector('.pop')?.textContent).toContain('Bêta');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ouvre le succès au clic, et la croix ou Échap passent au suivant', async () => {
    celebrate([
      { ...pop('Premier'), href: '/u/demo/succes#succes-cards_1' },
      pop('Deuxième'),
      pop('Troisième'),
    ]);
    const { container } = render(AchievementPop);
    const card = container.querySelector('a.pop') as HTMLAnchorElement;
    expect(card.getAttribute('href')).toBe('/u/demo/succes#succes-cards_1');
    // L'invitation à ouvrir, qui n'existe que sur une annonce qui mène quelque part.
    expect(card.querySelector('.open')).not.toBeNull();

    (container.querySelector('button.pop-skip') as HTMLButtonElement).click();
    await tick();
    expect(container.querySelector('.pop')?.textContent).toContain('Deuxième');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    expect(container.querySelector('.pop')?.textContent).toContain('Troisième');
  });
});
