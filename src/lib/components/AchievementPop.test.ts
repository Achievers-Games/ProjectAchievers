// @vitest-environment happy-dom
import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { celebrate, dismissAllPops } from '#lib/stores/achievement-pop';
import AchievementPop from './AchievementPop.svelte';

const pop = (title: string) => ({ title, icon: 'trophy', category: 'start', level: 2 });

afterEach(() => dismissAllPops());

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
});
