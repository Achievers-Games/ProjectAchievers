import { expect } from '@playwright/test';
import { test, login, ready } from './helpers';

test.describe('visiteur', () => {
  test("voit l'accueil public et les jeux", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Collectionne');
    await expect(page.locator('a[href^="/jeux/"]').first()).toBeVisible();
  });

  test('tire une phrase d’accroche', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(page.locator('.tagline')).not.toBeEmpty();

    await page.getByRole('button', { name: 'Bannière suivante' }).click();
    await expect(page.getByRole('button', { name: 'Aller à la bannière 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('fait glisser le carrousel jusqu’à la bannière suivante', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    const track = page.locator('.carousel-track');
    await expect(page.getByRole('button', { name: 'Aller à la bannière 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    const box = (await track.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.75, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.15, y, { steps: 10 });
    await page.mouse.up();

    // L'indicateur se recale sur ce qui reste à l'écran, sans clic sur un bouton.
    await expect(page.getByRole('button', { name: 'Aller à la bannière 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('parcourt tous les jeux d’un profil public', async ({ page }) => {
    await page.goto('/u/demo');
    await page.getByRole('link', { name: /Voir les \d+ jeux/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jeux de Demo');
    await expect(page.getByRole('link', { name: 'Cachés' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Légendaire', exact: true })).toBeVisible();
  });

  test('présente l’événement et son objectif commun', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Achève-les', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Achève-les.');
    await expect(page.getByRole('heading', { name: 'Objectif commun' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Objectif commun' })).toBeVisible();
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
    await expect(page.getByRole('link', { name: /Hades/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Portal 2/ })).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel('Filtrer par nom')).toHaveValue('hades');
  });

  test('charge la suite des jeux au défilement et la retrouve au retour', async ({ page }) => {
    await page.goto('/jeux');
    await ready(page);
    const cards = page.locator('main a[href^="/jeux/"]');
    await expect(cards).toHaveCount(36);
    await expect(page.getByRole('link', { name: 'Suivant' })).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => cards.count()).toBeGreaterThan(36);
    const loaded = await cards.count();
    const hrefs = await cards.evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(hrefs.length);

    await cards.last().click();
    await expect(page).toHaveURL(/\/jeux\/.+/);
    await page.goBack();
    // Le navigateur restaure la position une fois la liste rendue : on lui laisse ce temps.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // La suite se recharge au défilement : si la restauration est tombée pile en haut de liste,
    // on redescend comme le ferait un visiteur.
    if ((await cards.count()) <= 36) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
    await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(loaded);
  });

  test('sans JavaScript, ouvre une page suivante par lien', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/jeux');
    await page.getByRole('link', { name: 'Afficher plus' }).click();
    await expect(page).toHaveURL(/page=2/);
    await context.close();
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

  test('donne aux moteurs le fil d’Ariane de la fiche', async ({ page }) => {
    await page.goto('/jeux/portal-2');
    const origin = new URL(page.url()).origin;
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((scripts) => scripts.map((script) => JSON.parse(script.textContent ?? '')));
    expect(blocks.find((block) => block['@type'] === 'BreadcrumbList')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Jeux', item: `${origin}/jeux` },
        { '@type': 'ListItem', position: 2, name: 'Portal 2', item: `${origin}/jeux/portal-2` },
      ],
    });
  });

  test('révèle les succès cachés à la demande', async ({ page }) => {
    await page.goto('/jeux/portal-2');
    const secret = page.getByRole('link', { name: /Portal 2 — étape 51/ });
    await expect(page.getByRole('link', { name: /^Succès caché/ })).toBeVisible();
    await expect(secret).toHaveCount(0);

    await page.getByRole('link', { name: /Révéler les succès cachés/ }).click();
    await expect(secret).toBeVisible();
    await secret.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Portal 2 — étape 51');

    await page.getByRole('link', { name: 'Le masquer à nouveau' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Succès caché');
    await page.getByRole('link', { name: 'Révéler ce succès' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Portal 2 — étape 51');
  });

  test('distingue les succès obtenus', async ({ page }) => {
    await login(page);
    await page.goto('/jeux/portal-2');
    await expect(page.locator('.achievement-row[data-unlocked]').first()).toBeVisible();
    await expect(page.locator('.achievement-row:not([data-unlocked])').first()).toBeVisible();
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
