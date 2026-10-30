import { expect, test as base, type Page } from '@playwright/test';

/** Tout test échoue si la page journalise une erreur : un écran vide ne passe plus inaperçu. */
const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const location = message.location().url;
        // Les images distantes dépendent du réseau, pas de l'application.
        if (location.includes('steamstatic.com')) return;
        errors.push(`${message.text()} (${location})`);
      });
      await use();
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

const login = (page: Page) => page.goto('/auth/dev');

/** Attend que Svelte ait pris la main sur le HTML rendu par le serveur. */
const ready = (page: Page) =>
  page.locator('html[data-ready="true"]').waitFor({ state: 'attached' });

test.describe('visiteur', () => {
  test("voit l'accueil public et les jeux", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tous tes succès');
    await expect(page.locator('a[href^="/jeux/"]').first()).toBeVisible();
  });

  test('utilise la police prévue', async ({ page }) => {
    await page.goto('/');
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).toContain('Inter Variable');
  });

  test('filtre la liste et garde les filtres dans le lien', async ({ page }) => {
    await page.goto('/jeux');
    await ready(page);
    await page.getByLabel('Filtrer par nom').fill('hades');
    await expect(page).toHaveURL(/q=hades/);
    await expect(page.getByRole('link', { name: /Hades/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Portal 2/ })).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel('Filtrer par nom')).toHaveValue('hades');
  });

  test('cherche un jeu au clavier avec Ctrl K', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox', { name: 'Rechercher un jeu' });
    await input.fill('portal 2');
    await expect(page.getByRole('option', { name: /Portal 2/ })).toBeVisible();
    await input.press('Enter');
    await expect(page).toHaveURL(/\/jeux\/portal-2/);
  });

  test('lit la fiche et le profil public sans compte', async ({ page }) => {
    await page.goto('/jeux/portal-2');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Portal 2');
    await page.goto('/u/lea');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Léa');
  });

  test('voit le classement', async ({ page }) => {
    await page.goto('/communaute?periode=tout');
    await expect(page.getByRole('link', { name: /Demo/ }).first()).toBeVisible();
  });

  test('ne peut pas accéder au compte ni à la modération', async ({ page }) => {
    await page.goto('/compte');
    await expect(page).toHaveURL(/\/connexion/);
    const response = await page.request.get('/moderation');
    expect(response.status()).toBe(404);
  });

  test('reçoit une vraie page 404', async ({ page }) => {
    const response = await page.request.get('/jeux/ce-jeu-nexiste-pas');
    expect(response.status()).toBe(404);
  });

  test('ne reçoit pas de page sans en-têtes de sécurité', async ({ page }) => {
    const response = await page.request.get('/');
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

test.describe('membre', () => {
  test('voit son tableau de bord', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bonjour');
    await expect(page.getByText('Presque terminés')).toBeVisible();
  });

  test('voit les quatre comptes et son export', async ({ page }) => {
    await login(page);
    await page.goto('/compte');
    for (const name of ['Steam', 'PlayStation', 'Xbox', 'Discord', 'Google']) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    const response = await page.request.get('/compte/export');
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain('accessTokenEnc');
  });

  test('change de thème sans rechargement', async ({ page }) => {
    await login(page);
    await page.goto('/compte');
    await ready(page);
    const saved = page.waitForResponse((response) => response.url().includes('theme'));
    await page.getByRole('button', { name: 'Clair' }).click();
    await saved;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await ready(page);
    await page.getByRole('button', { name: 'Sombre' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('publie un commentaire assaini', async ({ page }) => {
    await login(page);
    await page.goto('/jeux/hades');
    await page
      .getByRole('link', { name: /étape 1$|étape 1 / })
      .first()
      .click();
    await expect(page).toHaveURL(/\/succes\//);

    const marker = `Astuce ${Date.now()}`;
    await page
      .getByRole('textbox', { name: 'Ton commentaire' })
      .fill(`${marker} <img src=x onerror=alert(1)>`);
    await page.getByRole('button', { name: 'Publier' }).click();

    const comment = page.getByRole('article').filter({ hasText: marker });
    await expect(comment).toBeVisible();
    await expect(comment.locator('.prose-user img')).toHaveCount(0);

    await comment.getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByRole('article').filter({ hasText: marker })).toHaveCount(0);
  });

  test('compare deux profils', async ({ page }) => {
    await login(page);
    await page.goto('/u/lea');
    await page.getByRole('link', { name: 'Comparer' }).click();
    await expect(page).toHaveURL(/\/comparer/);
    await expect(page.getByRole('heading', { name: /Jeux en commun/ })).toBeVisible();
  });

  test('accède à la modération avec le rôle adéquat', async ({ page }) => {
    await login(page);
    await page.goto('/moderation');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Modération');
  });

  test('se déconnecte', async ({ page }) => {
    await login(page);
    await page.goto('/compte');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page.getByRole('link', { name: 'Connexion' })).toBeVisible();
  });
});

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
