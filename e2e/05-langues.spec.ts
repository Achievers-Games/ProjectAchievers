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
});
