import { test, expect } from '@playwright/test';

test.describe('Application shell', () => {
  test('loads the app and shows the header', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('header')).toContainText('Chasse aux succès');
  });

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    await sidebar.locator('a', { hasText: 'Bibliothèque' }).click();
    await expect(page).toHaveURL(/\/games$/);
    await expect(page.locator('h1')).toContainText('Bibliothèque');
  });

  test('community page exposes the activity feed and leaderboard', async ({ page }) => {
    await page.goto('/community');

    await expect(page.locator('h1')).toContainText('chasseurs');
    await expect(page.getByText('En direct')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Classement' })).toBeVisible({ timeout: 15_000 });
  });

  test('library shows a search input and platform filters', async ({ page }) => {
    await page.goto('/games');

    await expect(page.locator('.filters input[type="search"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Tous' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Steam' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'PlayStation' })).toBeVisible();
  });

  test('settings page shows the Steam linking form', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.locator('input[placeholder="Pseudo Steam…"]')).toBeVisible();
    await expect(page.getByText('Comptes liés')).toBeVisible();
  });

  test('profile page shows the hunter identity block', async ({ page }) => {
    await page.goto('/profile');

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vitrine' })).toBeVisible();
  });

  test('unknown route still renders the app shell', async ({ page }) => {
    await page.goto('/route-inconnue');

    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByText('404')).toBeVisible();
  });

  test('unknown achievement shows the not-found state', async ({ page }) => {
    await page.goto('/achievements/inconnu');

    await expect(page.locator('h1, h2')).toContainText('Succès introuvable', {
      timeout: 15_000,
    });
  });
});
