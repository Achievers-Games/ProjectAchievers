// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SteamPrivacyPrompt from './SteamPrivacyPrompt.svelte';

// happy-dom annule les animations au démontage, ce qui lève une erreur hors du test : sans durée,
// la fenêtre apparaît et disparaît d'un coup.
vi.mock('svelte/transition', () => ({ fade: () => ({}), scale: () => ({}) }));

const key = 'pa_steam_prive:u1';
const prompt = () => screen.queryByTestId('steam-privacy-prompt');

describe('SteamPrivacyPrompt', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('oublie « Plus tard » quand le temps de jeu redevient public', async () => {
    localStorage.setItem(key, String(Date.now()));
    const view = render(SteamPrivacyPrompt, { userId: 'u1', issue: 'playtime' });
    expect(prompt()).toBeNull();

    // Rendu public, puis de nouveau privé : la fenêtre revient sans attendre le lendemain.
    await view.rerender({ userId: 'u1', issue: null });
    expect(localStorage.getItem(key)).toBeNull();
    await view.rerender({ userId: 'u1', issue: 'playtime' });
    flushSync();
    expect(prompt()).not.toBeNull();
  });

  it('demande tous les réglages d’un coup quand Steam cache toute la bibliothèque', () => {
    render(SteamPrivacyPrompt, { userId: 'u1', issue: 'library' });
    flushSync();
    expect(prompt()?.textContent).toContain('Game details');
    expect(prompt()?.textContent).toContain('Always keep my total playtime private');
  });

  it('garde « Ne plus afficher » pour de bon', async () => {
    localStorage.setItem(key, 'jamais');
    const view = render(SteamPrivacyPrompt, { userId: 'u1', issue: null });
    await view.rerender({ userId: 'u1', issue: 'playtime' });
    flushSync();
    expect(localStorage.getItem(key)).toBe('jamais');
    expect(prompt()).toBeNull();
  });
});
