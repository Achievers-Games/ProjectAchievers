# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app-shell.spec.ts >> Application shell >> sidebar is visible and navigation works
- Location: e2e\app-shell.spec.ts:10:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('h1')
Expected substring: "Bibliothèque de jeux"
Received string:    "Bibliothèque"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('h1') with timeout 5000ms
  - waiting for locator('h1')
    14 × locator resolved to <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight">Bibliothèque</h1>
       - unexpected value "Bibliothèque"

```

```yaml
- heading "Bibliothèque" [level=1]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Application shell', () => {
  4  |   test('loads the app and shows the header', async ({ page }) => {
  5  |     await page.goto('/');
  6  | 
  7  |     await expect(page.locator('header')).toBeVisible();
  8  |   });
  9  | 
  10 |   test('sidebar is visible and navigation works', async ({ page }) => {
  11 |     await page.goto('/');
  12 | 
  13 |     const sidebar = page.locator('aside');
  14 |     await expect(sidebar).toBeVisible();
  15 | 
  16 |     // Navigate to the library page
  17 |     await sidebar.locator('a', { hasText: 'Bibliothèque' }).click();
> 18 |     await expect(page.locator('h1')).toContainText('Bibliothèque de jeux');
     |                                      ^ Error: expect(locator).toContainText(expected) failed
  19 |   });
  20 | 
  21 |   test('library shows a search input and platform filters', async ({ page }) => {
  22 |     await page.goto('/#/games');
  23 | 
  24 |     await expect(page.locator('input[placeholder="Rechercher un jeu…"]')).toBeVisible();
  25 |     await expect(page.locator('button', { hasText: 'Tous' })).toBeVisible();
  26 |     await expect(page.locator('button', { hasText: 'Steam' })).toBeVisible();
  27 |     await expect(page.locator('button', { hasText: 'PlayStation' })).toBeVisible();
  28 |   });
  29 | 
  30 |   test('login page shows the Steam linking form', async ({ page }) => {
  31 |     await page.goto('/#/login');
  32 | 
  33 |     await expect(page.locator('input[placeholder="ID Steam (17 chiffres)"]')).toBeVisible();
  34 |   });
  35 | 
  36 |   test('unknown route redirects to the dashboard', async ({ page }) => {
  37 |     await page.goto('/#/unknown-route');
  38 | 
  39 |     await expect(page.locator('header')).toBeVisible();
  40 |   });
  41 | });
  42 | 
```