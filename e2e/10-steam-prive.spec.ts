import { expect } from '@playwright/test';
import { test, ready } from './helpers';

test.describe('temps de jeu Steam privé', () => {
  test('prévient le joueur au milieu de l’écran, et retient sa réponse', async ({ page }) => {
    await page.goto('/auth/dev?compte=nora');
    await ready(page);

    const prompt = page.getByTestId('steam-privacy-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('heading')).toContainText('Il manque des jeux à ton profil');
    await expect(prompt.getByRole('link', { name: 'Le rendre public dans Steam' })).toHaveAttribute(
      'href',
      'https://steamcommunity.com/my/edit/settings',
    );

    // « Plus tard » : la fenêtre se ferme et ne revient pas à la page suivante.
    await prompt.getByRole('button', { name: 'Plus tard' }).click();
    await expect(prompt).toHaveCount(0);
    await page.goto('/compte');
    await ready(page);
    await expect(prompt).toHaveCount(0);
    // Le rappel reste sur la page de compte, sous la ligne Steam.
    await expect(page.getByTestId('steam-playtime-private')).toBeVisible();

    // Un autre jour : elle revient, et « Ne plus afficher » la fait taire pour de bon.
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('pa_steam_prive:')) localStorage.setItem(key, '1');
      }
    });
    await page.reload();
    await ready(page);
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Ne plus afficher' }).click();
    await page.reload();
    await ready(page);
    await expect(prompt).toHaveCount(0);
  });

  test('ne dérange pas un joueur dont le temps de jeu est public', async ({ page }) => {
    await page.goto('/auth/dev');
    await ready(page);
    await expect(page.getByTestId('steam-privacy-prompt')).toHaveCount(0);
  });
});
