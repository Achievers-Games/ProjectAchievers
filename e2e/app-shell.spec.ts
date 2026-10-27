import { test, expect } from '@playwright/test';

test.describe('Application shell', () => {
  test('loads the app and shows the header', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('header')).toBeVisible();
  });

  test('sidebar is visible and navigation works', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Navigate to the library page
    await sidebar.locator('a', { hasText: 'Bibliothèque' }).click();
    await expect(page.locator('h1')).toContainText('Bibliothèque');
  });

  test('library shows a search input and platform filters', async ({ page }) => {
    await page.goto('/#/games');

    await expect(page.locator('input[placeholder="Rechercher un jeu…"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Tous' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Steam' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'PlayStation' })).toBeVisible();
  });

  test('login page shows the Steam linking form', async ({ page }) => {
    await page.goto('/#/login');

    await expect(page.locator('input[placeholder="ID Steam (17 chiffres)"]')).toBeVisible();
  });

  test('unknown route redirects to the dashboard', async ({ page }) => {
    await page.goto('/#/unknown-route');

    await expect(page.locator('header')).toBeVisible();
  });
});
