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

  test('parcourt tous les jeux d’un profil public', async ({ page }) => {
    await page.goto('/u/demo');
    await page.getByRole('link', { name: /Voir les \d+ jeux/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jeux de Demo');
    await expect(page.getByRole('link', { name: 'Cachés' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Platine', exact: true })).toBeVisible();
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

  test('voit ses comptes et son export', async ({ page }) => {
    await login(page);
    await page.goto('/compte');
    for (const name of ['Steam', 'PlayStation', 'Xbox', 'RetroAchievements', 'Discord', 'Google']) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByLabel('Pseudo RetroAchievements')).toBeVisible();
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
    const save = page.getByRole('button', { name: 'Enregistrer' }).first();

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

  test('traduit d’office un texte écrit dans une autre langue', async ({ page, browser }) => {
    await login(page);
    await page.goto('/jeux/hades');
    await page
      .getByRole('link', { name: /étape 1$|étape 1 / })
      .first()
      .click();
    await expect(page).toHaveURL(/\/succes\//);

    const marker = `Automatique ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Ton commentaire' }).fill(marker);
    await page.getByRole('button', { name: 'Publier' }).click();
    const mine = page.getByRole('article').filter({ hasText: marker });
    await expect(mine).toBeVisible();

    const reader = await browser.newPage({ locale: 'en-US' });
    await reader.route('**/*translate', (route) =>
      route.fulfill({
        json: { type: 'success', status: 200, data: '[{"html":1},"<p>Automatic tip</p>"]' },
      }),
    );
    await reader.goto(page.url());
    await expect(reader.getByText('Automatic tip').first()).toBeVisible();
    await expect(reader.getByRole('button', { name: /See original/ }).first()).toBeVisible();
    await reader.close();

    await mine.getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByRole('article').filter({ hasText: marker })).toHaveCount(0);
  });

  test('équipe un cadre obtenu, jamais un cadre manquant', async ({ page }) => {
    await login(page);
    await page.goto('/compte');
    await ready(page);
    await expect(page.getByRole('radio', { name: /Collectionneur/ })).toBeDisabled();

    await page.getByRole('radio', { name: /Place 1/ }).check();
    await page.getByRole('button', { name: 'Enregistrer' }).nth(1).click();
    await expect(page.getByText('Cadre enregistré.')).toBeVisible();
    await page.goto('/classement');
    await expect(page.locator('.avatar-frame[data-frame="podium-1"]').first()).toBeVisible();

    await page.goto('/compte');
    await ready(page);
    await page.getByRole('radio', { name: 'Aucun' }).check();
    await page.getByRole('button', { name: 'Enregistrer' }).nth(1).click();
    await expect(page.getByText('Cadre enregistré.')).toBeVisible();
  });

  test('choisit les cartes de sa vitrine, puis revient aux meilleures', async ({ page }) => {
    await login(page);
    await page.goto('/compte/vitrine');
    await ready(page);
    await page.getByRole('button', { name: 'Personnalisée' }).click();

    const add = page.getByRole('button', { name: 'Ajouter' });
    await add.first().click();
    await expect(page.getByRole('heading', { name: /Dans ma vitrine \(1\/8\)/ })).toBeVisible();

    await page.goto('/u/demo');
    await expect(page.getByRole('region', { name: 'Vitrine' }).locator('a[data-tier]')).toHaveCount(
      1,
    );
    await page.getByRole('link', { name: 'Modifier ma vitrine' }).click();
    await ready(page);

    await page.getByRole('button', { name: 'Retirer' }).click();
    await expect(page.getByRole('heading', { name: /Dans ma vitrine \(0\/8\)/ })).toBeVisible();
    await page.getByRole('button', { name: 'Les meilleures' }).click();
    await expect(page.getByRole('button', { name: 'Les meilleures' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('ouvre son profil public et va le modifier', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.getByRole('link', { name: 'Profil' }).first().click();
    await expect(page).toHaveURL(/\/u\/demo/);
    await page.getByRole('link', { name: 'Modifier', exact: true }).click();
    await expect(page).toHaveURL(/\/compte$/);
  });

  test('repère les jeux qui comptent pour la saison', async ({ page }) => {
    await login(page);
    await page.goto('/jeux?filtre=saison&tri=progression');
    await expect(page.locator('.season-badge').first()).toBeVisible();
    await page.locator('.game-card').first().click();
    await expect(page.getByText('Ce jeu compte pour la saison.')).toBeVisible();
  });

  test('explique les règles de la saison', async ({ page }) => {
    await login(page);
    await page.goto('/saison');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Achève-les.');
    await expect(page.getByText('Les succès débloqués en rafale ne rapportent rien')).toBeVisible();
  });

  test('publie un guide riche et garde ses cases cochées', async ({ page }) => {
    const title = `Étapes ${Date.now()}`;
    await login(page);
    await page.goto('/jeux/portal-2');
    await page
      .getByRole('link', { name: /étape 3 / })
      .first()
      .click();
    await ready(page);
    await page.getByRole('button', { name: 'Écrire un guide' }).click();
    await page.locator('#guide-content').fill(`## ${title}\n\n- [ ] Trouver la clé\n- [ ] Ouvrir`);
    await page.getByRole('button', { name: 'Publier' }).first().click();

    const heading = page.getByRole('heading', { level: 2, name: title });
    await expect(heading).toBeVisible();
    const box = heading.locator('..').getByRole('checkbox').first();
    const saved = page.waitForResponse((r) => r.url().includes('check'));
    await box.check();
    await saved;

    await page.reload();
    await ready(page);
    await expect(
      page
        .getByRole('heading', { level: 2, name: title })
        .locator('..')
        .getByRole('checkbox')
        .first(),
    ).toBeChecked();
  });

  test('garde le bouton d’actualisation sur toutes les pages', async ({ page }) => {
    await login(page);
    await page.goto('/communaute');
    await ready(page);
    await page.getByRole('button', { name: 'Actualiser mes comptes' }).click();
    await expect(page.getByText(/réessaie dans quelques minutes/)).toBeVisible();
  });

  test('montre une pastille sur un joueur présent', async ({ page }) => {
    await login(page);
    await page.goto('/u/demo');
    await ready(page);
    await expect(page.locator('header .avatar-online').first()).toBeVisible();
  });

  test('ajoute un ami et discute en direct', async ({ page, browser }) => {
    await login(page);
    await page.goto('/u/marco');
    await ready(page);
    await page.getByRole('button', { name: 'Ajouter' }).click();
    await expect(page.getByText('Demande envoyée.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Demande en attente' })).toBeVisible();

    const other = await browser.newContext();
    const friend = await other.newPage();
    await friend.goto('/auth/dev?compte=marco');
    await friend.goto('/amis');
    await ready(friend);
    await friend.getByRole('button', { name: 'Accepter' }).first().click();
    await friend.getByRole('button', { name: 'Message', exact: true }).first().click();
    await expect(friend).toHaveURL(/\/messages\/./);
    await ready(friend);

    await page.goto('/amis');
    await ready(page);
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Marco' })
      .getByRole('button', { name: 'Message', exact: true })
      .click();
    await expect(page).toHaveURL(/\/messages\/./);
    await ready(page);

    const text = `Salut ${Date.now()}`;
    const field = page.getByLabel('Écris un message…');
    await expect(page.getByText(/Aucun message|Salut/).first()).toBeVisible();
    await field.fill(text);
    await field.press('Enter');
    await expect(friend.getByText(text)).toBeVisible();
    await expect(friend.getByRole('link', { name: 'Demo', exact: true }).first()).toHaveAttribute(
      'href',
      '/u/demo',
    );

    // Un message reçu se signale sans ouvrir de fenêtre.
    const stream = page.waitForResponse((r) => r.url().includes('/api/sync/events'));
    await page.goto('/jeux');
    await stream;
    await ready(page);
    const reply = friend.getByLabel('Écris un message…');
    await reply.fill('Bien reçu');
    await reply.press('Enter');
    const bar = page.getByRole('button', { name: /^Messages/ });
    await expect(bar.locator('.social-badge')).toHaveText('1');
    await expect(page.getByRole('region', { name: 'Marco' })).toBeHidden();
    await other.close();

    await page.goto('/jeux');
    await ready(page);
    await page.getByRole('button', { name: /^Messages/ }).click();
    await page.getByRole('button', { name: /Marco/ }).click();
    await expect(page.getByRole('region', { name: 'Marco' })).toBeVisible();
    await page.reload();
    await ready(page);
    await expect(page.getByRole('region', { name: 'Marco' })).toBeVisible();
  });

  test('crée un clan et ouvre sa discussion', async ({ page }) => {
    await login(page);
    await page.goto('/clan');
    await ready(page);
    const leave = page.getByRole('button', { name: 'Quitter le clan' });
    if (await leave.isVisible()) await leave.click();
    const name = `Clan ${Date.now()}`;
    await page.getByLabel('Nom du clan').fill(name);
    await page.getByRole('button', { name: 'Créer' }).click();
    await page.getByRole('link', { name: 'Page publique' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    await page.goto('/clans');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    await page.goto('/clan');
    await ready(page);
    await page.getByRole('button', { name: 'Discussion du clan' }).click();
    await expect(page).toHaveURL(/\/messages\/./);
  });

  test('propose les notifications après un moment, puis se laisse reporter', async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      localStorage.setItem('pa_push_temps', '110');
      Object.defineProperty(Notification, 'permission', { value: 'default' });
    });
    await login(page);
    await page.goto('/jeux');
    await ready(page);
    await page.clock.fastForward(11_000);

    const prompt = page.getByRole('dialog', { name: /Tes amis/ });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('checkbox')).toHaveCount(3);
    await prompt.getByRole('button', { name: 'Plus tard' }).click();
    await expect(prompt).toBeHidden();

    await page.reload();
    await ready(page);
    await page.clock.fastForward(11_000);
    await expect(prompt).toBeHidden();
  });

  test('laisse masquer sa présence', async ({ page }) => {
    await page.goto('/auth/dev?compte=lea');
    await page.goto('/compte');
    await ready(page);
    const inPresence = async () =>
      ((await (await page.request.get('/api/presence')).json()) as string[]).includes('lea');
    await page.getByLabel(/Afficher ma présence/).check();
    await expect.poll(inPresence).toBe(true);

    await page.getByLabel(/Afficher ma présence/).uncheck();
    await expect(page.getByText('Présence enregistrée.')).toBeVisible();
    await expect.poll(inPresence).toBe(false);

    await page.getByLabel(/Afficher ma présence/).check();
    await expect.poll(inPresence).toBe(true);
  });

  test('donne le lien des réglages de confidentialité', async ({ page }) => {
    await page.goto('/auth/dev?compte=marco');
    await page.goto('/compte?bienvenue=1');
    await expect(page.getByRole('link', { name: 'Steam', exact: true })).toHaveAttribute(
      'href',
      'https://steamcommunity.com/my/edit/settings',
    );
  });

  test('réunit les amis, les messages et le clan dans Communauté', async ({ page }) => {
    await login(page);
    await page.goto('/jeux');
    await page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: 'Communauté' })
      .click();
    await expect(page).toHaveURL(/\/communaute/);
    const tabs = page.getByRole('navigation', { name: 'Communauté' });
    await tabs.getByRole('link', { name: 'Amis' }).click();
    await expect(page).toHaveURL(/\/amis/);
    await page
      .getByRole('navigation', { name: 'Communauté' })
      .getByRole('link', { name: 'Activité' })
      .click();
    await page
      .getByRole('group', { name: 'Activité' })
      .getByRole('link', { name: 'Global' })
      .click();
    await expect(page).toHaveURL(/onglet=global/);
    await expect(page.getByRole('link', { name: 'Classement', exact: true }).first()).toBeVisible();
    await page.getByRole('group', { name: 'Activité' }).getByRole('link', { name: 'Amis' }).click();
    await expect(page.getByRole('link', { name: 'Classement des amis' })).toBeVisible();
  });

  test('envoie un retour et le suit depuis la modération', async ({ page }) => {
    const text = `Le bouton plante ${Date.now()}`;
    await login(page);
    await page.goto('/retours');
    await ready(page);
    await page.getByLabel('Catégorie').selectOption('COMMUNITY');
    await page.getByLabel('Ton message').fill(text);
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await expect(
      page.getByText('Merci, c’est bien reçu.').or(page.getByText("Merci, c'est bien reçu.")),
    ).toBeVisible();
    await expect(page.getByText(text)).toBeVisible();

    await page.goto('/moderation');
    await ready(page);
    const entry = page.getByRole('article').filter({ hasText: text });
    const saved = page.waitForResponse((r) => r.url().includes('feedback'));
    await entry.getByRole('combobox').selectOption('PLANNED');
    await saved;
    await page.goto('/retours');
    await expect(page.getByRole('listitem').filter({ hasText: text })).toContainText('Prévu');
    await expect(page.getByRole('listitem').filter({ hasText: text })).toContainText('Communauté');
  });

  test('signale une demande d’ami en direct sur le site', async ({ page, browser }) => {
    const other = await browser.newContext();
    const friend = await other.newPage();
    await friend.goto('/auth/dev?compte=lea');
    // Le flux en direct doit être ouvert avant la demande.
    const stream = friend.waitForResponse((r) => r.url().includes('/api/sync/events'));
    await friend.goto('/jeux');
    await stream;
    await ready(friend);

    await page.goto('/auth/dev?compte=marco');
    await page.goto('/u/lea');
    await ready(page);
    await page.getByRole('button', { name: 'Ajouter' }).click();

    await expect(friend.getByText(/Marco veut t.ajouter en ami/)).toBeVisible();
    const community = friend
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: /Communauté/ });
    await expect(community.locator('.social-badge')).toHaveText('1');
    await friend.goto('/amis');
    await ready(friend);
    await friend.getByRole('button', { name: 'Refuser' }).first().click();
    await expect(community.locator('.social-badge')).toBeHidden();
    await other.close();
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

test('montre le podium et le classement complet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Classement complet' }).last().click();
  await expect(page).toHaveURL(/classement/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Classement');
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
