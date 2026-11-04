// @vitest-environment happy-dom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import GameCard from './GameCard.svelte';

const game = {
  name: 'Hollow Knight',
  slug: 'hollow-knight',
  platform: 'STEAM' as const,
  headerUrl: 'https://cdn.example/header.jpg',
  totalAchievements: 63,
};

const progress = (completion: number, unlockedCount = 63) => ({
  unlockedCount,
  completion,
  platinum: false,
});

describe('carte de jeu', () => {
  it('montre le niveau et les exemplaires d’un jeu terminé', () => {
    const { container } = render(GameCard, {
      props: { game, progress: progress(100), tier: 5, copies: 3 },
    });
    const card = container.querySelector('a.game-card') as HTMLElement;

    expect(card.dataset.complete).toBe('true');
    expect(card.dataset.tier).toBe('5');
    expect(card.dataset.copies).toBe('3');
    expect(card.textContent).toContain('×3');
    expect(container.querySelector('.foil')).not.toBeNull();
  });

  it('n’annonce ni niveau ni exemplaires sur un jeu en cours', () => {
    const { container } = render(GameCard, {
      props: { game, progress: progress(48, 30), tier: 3, target: 4 },
    });
    const card = container.querySelector('a.game-card') as HTMLElement;

    expect(card.dataset.complete).toBeUndefined();
    expect(card.dataset.tier).toBeUndefined();
    expect(card.dataset.copies).toBeUndefined();
    // Le pas de progression est affiché : 48 % ont franchi un quart, pas encore deux.
    expect(card.dataset.step).toBe('1');
    expect(container.textContent).toContain('30 / 63');
  });

  it('propose le palier suivant quand un exemplaire supplémentaire se profile', () => {
    const { container } = render(GameCard, {
      props: {
        game,
        progress: progress(100),
        tier: 2,
        copies: 1,
        target: 3,
        next: { copies: 3, completion: 100, platform: 'STEAM', console: null },
      },
    });

    expect(container.querySelector('[data-next="3"]')).not.toBeNull();
    expect(container.textContent).toContain('×3');
  });

  it('se rabat sur l’icône quand la bannière manque', () => {
    const { container } = render(GameCard, {
      props: { game: { ...game, headerUrl: null }, tier: 1 },
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('Hollow Knight');
  });

  it('garde la carte terminée en mode liste, sans animation de fondu', () => {
    const { container } = render(GameCard, {
      props: { game, progress: progress(100), layout: 'liste', tier: 4, copies: 2 },
    });
    const card = container.querySelector('a.game-card') as HTMLElement;

    expect(card.classList.contains('flex-col')).toBe(false);
    expect(card.dataset.copies).toBe('2');
    expect(container.querySelector('.fx-aurora')).toBeNull();
  });
});
