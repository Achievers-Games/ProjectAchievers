// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SteamPrivacyPrompt from './SteamPrivacyPrompt.svelte';

const key = 'pa_steam_prive:u1';
const prompt = () => screen.queryByTestId('steam-privacy-prompt');

describe('SteamPrivacyPrompt', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('oublie « Plus tard » quand le temps de jeu redevient public', async () => {
    localStorage.setItem(key, String(Date.now()));
    const view = render(SteamPrivacyPrompt, { userId: 'u1', hidden: true });
    expect(prompt()).toBeNull();

    // Rendu public, puis de nouveau privé : la fenêtre revient sans attendre le lendemain.
    await view.rerender({ userId: 'u1', hidden: false });
    expect(localStorage.getItem(key)).toBeNull();
    await view.rerender({ userId: 'u1', hidden: true });
    flushSync();
    expect(prompt()).not.toBeNull();
  });

  it('garde « Ne plus afficher » pour de bon', async () => {
    localStorage.setItem(key, 'jamais');
    const view = render(SteamPrivacyPrompt, { userId: 'u1', hidden: false });
    await view.rerender({ userId: 'u1', hidden: true });
    flushSync();
    expect(localStorage.getItem(key)).toBe('jamais');
    expect(prompt()).toBeNull();
  });
});
