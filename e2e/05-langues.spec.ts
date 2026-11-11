import { expect } from '@playwright/test';
import { test } from './helpers';

test.describe('langues', () => {
  test.use({ locale: 'de-DE' });

  test('suit le navigateur, puis garde la langue choisie', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Sammle');

    await page.locator('html[data-ready="true"]').waitFor({ state: 'attached' });
    await page.getByLabel('Sprache').selectOption('ja');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

    await page.goto('/jeux');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ゲーム');
  });

  test('donne une adresse à chaque langue, que les moteurs peuvent référencer', async ({
    page,
  }) => {
    // Le navigateur est en allemand, mais /en/ décide : la page est en anglais pour tout le monde.
    await page.goto('/en/jeux');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Games');

    const origin = new URL(page.url()).origin;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${origin}/en/jeux`,
    );
    const alternates = page.locator('link[rel="alternate"][hreflang]');
    await expect(alternates).toHaveCount(9);
    await expect(page.locator('link[hreflang="de"]')).toHaveAttribute('href', `${origin}/de/jeux`);
    await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute(
      'href',
      `${origin}/jeux`,
    );

    // Les liens sans préfixe gardent ensuite la langue de l'adresse par laquelle on est arrivé.
    await page.goto('/communaute');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
