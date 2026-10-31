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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Collectionne');
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
    await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(loaded);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
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

  test('ne voit que ses jeux, et voit une carte arriver en direct', async ({ page }) => {
    await login(page);
    await page.goto('/jeux');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mes jeux');
    await expect(page.getByText('9 jeux')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tous', exact: true })).toHaveCount(0);

    const drop = {
      user: { handle: 'lea', displayName: 'Léa', avatarUrl: null },
      game: { name: 'Celeste', slug: 'celeste', headerUrl: null },
      unlockedAt: new Date().toISOString(),
    };
    await page.route('**/api/cartes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify(drop)}\n\n`,
      }),
    );
    await page.goto('/');
    const live = page.getByRole('region', { name: /En direct/ });
    await expect(live.getByRole('link', { name: /Hades/ }).first()).toBeVisible();
    await expect(live.getByRole('link', { name: /Celeste/ })).toBeVisible();
  });

  test('voit ses cartes rares et une révélation après une synchronisation', async ({ page }) => {
    await login(page);
    await page.goto('/u/demo');
    const showcase = page.getByRole('region', { name: 'Vitrine' });
    // Hades, fini sur trois plateformes, passe en tête sous une seule carte Prismatique.
    await expect(showcase.locator('a[data-tier]')).toHaveCount(2);
    await expect(showcase.locator('a[data-tier="3"]')).toHaveCount(1);
    await expect(showcase.getByText('Prismatique')).toBeVisible();

    const cards = Array.from({ length: 12 }, (_, index) => ({
      game: {
        name: `Jeu ${index}`,
        slug: `jeu-${index}`,
        platform: 'STEAM',
        headerUrl: null,
        totalAchievements: 10,
      },
      progress: { unlockedCount: 10, completion: 100, platinum: false },
      unlockedAt: null,
    }));
    const event = {
      provider: 'STEAM',
      status: 'COMPLETED',
      processed: 1,
      total: 1,
      achievements: 3,
      rewards: cards.slice(0, 10),
      moreRewards: 2,
    };
    await page.route('**/api/sync/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify(event)}\n\n`,
      }),
    );
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Nouvelles cartes' });
    await expect(dialog.getByText('10 cartes 100 % obtenues !')).toBeVisible();
    await expect(dialog.getByText('+ 2 autres déblocages')).toBeVisible();
    await page.unroute('**/api/sync/events');

    // Les cartes se retournent une à une.
    const flipped = dialog.locator('.reward-flip.revealed');
    await expect.poll(() => flipped.count()).toBeGreaterThan(0);
    expect(await flipped.count()).toBeLessThan(10);

    // Un rechargement ne perd rien.
    await page.reload();
    await expect(dialog.getByText('10 cartes 100 % obtenues !')).toBeVisible();

    // Premier clic : tout est retourné. Deuxième clic : fermé.
    await dialog.click({ position: { x: 10, y: 10 } });
    await expect(flipped).toHaveCount(10);
    await expect(dialog.getByRole('button', { name: 'Fermer' })).toBeVisible();
    await dialog.click({ position: { x: 10, y: 10 } });
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(dialog).toBeHidden();
  });

  test('rejoue la révélation depuis la page de test', async ({ page }) => {
    await login(page);
    await page.goto('/dev/revelation');
    await ready(page);
    await page
      .getByRole('button', { name: /^Ouvrir [0-9]+ cartes$/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Nouvelles cartes' });
    await page.keyboard.press('Enter');
    await expect(dialog.locator('.reward-flip.revealed')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('masque les jeux adultes sauf si le compte les demande', async ({ page }) => {
    await page.goto('/auth/dev?compte=lea');
    await page.goto('/jeux');
    const adult = page.getByRole('link', { name: /Jeu réservé aux adultes/ });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mes jeux');
    await expect(adult).toHaveCount(0);
    expect((await page.request.get('/jeux/jeu-reserve-aux-adultes')).status()).toBe(404);

    await page.goto('/compte');
    await ready(page);
    const saved = () => page.waitForResponse((r) => r.url().includes('adult'));
    let response = saved();
    await page.getByLabel(/Afficher les jeux pour adultes/).check();
    await response;

    await page.goto('/jeux');
    await expect(adult).toBeVisible();
    expect((await page.request.get('/jeux/jeu-reserve-aux-adultes')).status()).toBe(200);

    await page.goto('/compte');
    await ready(page);
    response = saved();
    await page.getByLabel(/Afficher les jeux pour adultes/).uncheck();
    await response;
  });

  test('cache un jeu de sa bibliothèque et le retrouve', async ({ page }) => {
    await page.goto('/auth/dev?compte=marco');
    await page.goto('/jeux/portal-2');
    await ready(page);
    await page.getByRole('button', { name: 'Cacher ce jeu' }).click();
    await expect(page.getByRole('button', { name: 'Remettre dans ma bibliothèque' })).toBeVisible();

    await page.goto('/jeux');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mes jeux');
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: /Portal 2/ })).toHaveCount(0);

    await page.getByRole('link', { name: 'Cachés' }).click();
    await expect(main.getByRole('link', { name: /Portal 2/ })).toBeVisible();

    // Un autre compte ne voit pas ce jeu sur le profil.
    const visitor = await page.context().browser()?.newContext();
    const other = await visitor?.newPage();
    await other?.goto(new URL('/u/marco', page.url()).href);
    if (other)
      await expect(other.locator('main').getByRole('heading', { level: 1 })).toHaveText('Marco');
    expect(await other?.locator('main a[href="/jeux/portal-2"]').count()).toBe(0);
    await visitor?.close();

    await page.goto('/jeux/portal-2');
    await ready(page);
    await page.getByRole('button', { name: 'Remettre dans ma bibliothèque' }).click();
    await expect(page.getByRole('button', { name: 'Cacher ce jeu' })).toBeVisible();
  });

  test('montre l’avancement vers le niveau suivant', async ({ page }) => {
    await login(page);
    await page.goto('/jeux?q=astro');
    const card = page.locator('main a[data-tier="1"][data-next="2"]');
    await expect(card).toBeVisible();
    await expect(card.getByText('Platine : Steam 40 %')).toBeVisible();
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    await expect(card.getByRole('progressbar')).toHaveAttribute('data-base', '1');
  });

  test('marque les paliers de progression', async ({ page }) => {
    await login(page);
    await page.goto('/jeux?tri=progression');
    await expect(page.locator('main a[data-step]').first()).toBeVisible();
    await expect(page.locator('main a[data-tier] .step-badge')).toHaveCount(0);
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

  test('change son nom affiché et voit les erreurs', async ({ page }) => {
    await login(page);
    await page.goto('/compte');
    await ready(page);
    const name = page.getByLabel('Nom affiché');
    const original = await name.inputValue();
    const save = page.getByRole('button', { name: 'Enregistrer' });

    await name.fill('Nouveau nom');
    await save.click();
    await expect(page.getByText('Profil enregistré.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Nom affiché')).toHaveValue('Nouveau nom');

    await ready(page);
    await page.getByLabel('Identifiant', { exact: true }).fill('a_b');
    await save.click();
    await expect(page.getByText('Ton identifiant doit faire')).toBeVisible();

    await page.reload();
    await ready(page);
    await page.getByLabel('Nom affiché').fill(original);
    await save.click();
    await expect(page.getByText('Profil enregistré.')).toBeVisible();
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

  test('traduit le commentaire d’une autre personne, et revient à l’original', async ({
    page,
    browser,
  }) => {
    await login(page);
    await page.goto('/jeux/hades');
    await page
      .getByRole('link', { name: /étape 1$|étape 1 / })
      .first()
      .click();
    await expect(page).toHaveURL(/\/succes\//);

    const marker = `À traduire ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Ton commentaire' }).fill(marker);
    await page.getByRole('button', { name: 'Publier' }).click();
    const mine = page.getByRole('article').filter({ hasText: marker });
    await expect(mine.getByRole('button', { name: 'Traduire' })).toHaveCount(0);

    const visitor = await browser.newPage({ locale: 'fr-FR' });
    await visitor.route('**/*translate', (route) =>
      route.fulfill({
        json: { type: 'success', status: 200, data: '[{"html":1},"<p>Translated tip</p>"]' },
      }),
    );
    await visitor.goto(page.url());
    await ready(visitor);
    const other = visitor.getByRole('article').filter({ hasText: marker });
    await other.getByRole('button', { name: 'Traduire' }).click();
    await expect(visitor.getByText('Translated tip')).toBeVisible();

    await visitor.getByRole('button', { name: /Voir l'original/ }).click();
    await expect(other).toContainText(marker);
    await visitor.close();

    await mine.getByRole('button', { name: 'Supprimer' }).click();
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
