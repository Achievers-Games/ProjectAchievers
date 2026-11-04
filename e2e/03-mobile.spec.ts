import { expect } from '@playwright/test';
import { test, login } from './helpers';

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('garde une navigation basse et aucun débordement', async ({ page }) => {
    await login(page);
    for (const path of [
      '/',
      '/jeux',
      '/communaute',
      '/jeux/hades',
      '/u/lea',
      '/compte',
      '/comparer?a=demo&b=lea',
      '/messages',
      '/amis',
      '/clan',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Navigation mobile' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `débordement horizontal sur ${path}`).toBe(false);
    }
  });
});
