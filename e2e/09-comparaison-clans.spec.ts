import { expect, type Page } from '@playwright/test';
import { test, login, ready } from './helpers';

test.describe('comparaison par jeu', () => {
  test('ouvre la comparaison depuis un profil, filtre, puis quitte', async ({ page }) => {
    await login(page);
    await page.goto('/u/lea');
    await ready(page);

    // La carte du jeu ouvre la fiche telle que ce joueur l'a faite : sa progression à lui.
    const card = page.locator('a[href^="/jeux/"][href*="joueur=lea"]').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/jeux\/[^?]+\?joueur=lea/);
    await ready(page);
    const theirs = page.getByTestId('game-player');
    await expect(theirs.getByRole('heading', { level: 2 })).toContainText('Progression de');

    // De là, la comparaison s'ouvre quand je possède aussi cette version.
    await theirs.getByRole('link', { name: 'Comparer avec moi' }).click();
    await expect(page).toHaveURL(/\/jeux\/[^?]+\?avec=lea/);
    await ready(page);

    const compare = page.getByTestId('compare');
    await expect(compare.getByRole('heading', { level: 2 })).toContainText('Comparaison');
    await expect(page.getByTestId('compare-summary')).toContainText(/en commun ·/);

    const common = page.getByRole('button', { name: 'En commun' });
    await common.click();
    await expect(common).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('link', { name: 'Quitter la comparaison' }).click();
    await expect(page).not.toHaveURL(/avec=/);
    await expect(page.getByTestId('compare')).toHaveCount(0);
  });

  test('révèle les succès cachés sans perdre la comparaison', async ({ page }) => {
    await login(page);
    // Elden Ring : son dernier succès, secret, n'est pas débloqué par la démonstration.
    await page.goto('/jeux/elden-ring?avec=lea');
    await ready(page);

    const reveal = page.getByRole('link', { name: /Révéler les succès cachés/ });
    await expect(reveal).toHaveAttribute('href', /avec=lea/);
    await reveal.click();
    await expect(page).toHaveURL(/avec=lea/);
    await expect(page).toHaveURL(/caches=1/);
    const conceal = page.getByRole('link', { name: 'Masquer les succès cachés' });
    await expect(conceal).toHaveAttribute('href', /avec=lea/);
  });

  test('propose de comparer avec un ami qui possède la version', async ({ page, browser }) => {
    await login(page);
    await page.goto('/u/marco');
    await ready(page);
    const add = page.getByRole('button', { name: 'Ajouter', exact: true });
    if (await add.isVisible()) {
      await add.click();
      await expect(page.getByText('Demande envoyée.')).toBeVisible();
      const context = await browser.newContext();
      try {
        const marco = await context.newPage();
        await marco.goto('/auth/dev?compte=marco');
        await marco.goto('/amis');
        await ready(marco);
        await marco
          .getByRole('listitem')
          .filter({ hasText: 'Demo' })
          .getByRole('button', { name: 'Accepter' })
          .click();
        await expect(marco.getByRole('button', { name: 'Accepter' })).toHaveCount(0);
      } finally {
        await context.close();
      }
    }
    await page.goto('/jeux/hades');
    await ready(page);

    await page.getByText('Comparer avec un ami').click();
    await page.locator('details').getByRole('link', { name: 'Marco' }).click();
    await expect(page).toHaveURL(/avec=marco/);
    await expect(page.getByTestId('compare').getByRole('heading', { level: 2 })).toContainText(
      'Marco',
    );
  });

  test('affiche le compte d’amis et sa limite', async ({ page }) => {
    await login(page);
    await page.goto('/amis');
    await ready(page);
    await expect(page.getByText(/\d+ \/ 30 amis/)).toBeVisible();
  });
});

/** Fait quitter son clan au joueur s'il en a un : le test repart toujours de joueurs sans clan. */
async function leaveAnyClan(page: Page) {
  await page.goto('/clan');
  await ready(page);
  const previous = page.getByRole('button', { name: 'Quitter le clan' });
  if (await previous.isVisible()) {
    await previous.click();
    await expect(page.getByLabel('Nom du clan')).toBeVisible();
  }
}

test.describe('clans', () => {
  test('liste les clans aux points et accepte une demande d’adhésion', async ({
    page,
    browser,
  }) => {
    // Trois joueurs, une douzaine de pages : 30 s ne suffisent pas toujours sur un runner lent.
    test.slow();
    await login(page);
    // Le joueur de test peut déjà avoir un clan : on en repart pour repasser par la création.
    await leaveAnyClan(page);

    const name = `Clan rôles ${Date.now()}`;
    await page.getByLabel('Nom du clan').fill(name);
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

    // Un joueur sans clan demande à rejoindre depuis le classement.
    const marcoContext = await browser.newContext();
    const marco = await marcoContext.newPage();
    await marco.goto('/auth/dev?compte=marco');
    // Une tentative précédente a pu le laisser membre : la liste ne lui proposerait plus de rejoindre.
    await leaveAnyClan(marco);
    await marco.goto('/clans');
    await ready(marco);
    const clanRow = () => marco.getByRole('listitem').filter({ hasText: name });
    await expect(clanRow().getByText('Points')).toBeVisible();
    await clanRow().getByRole('button', { name: 'Demander à rejoindre' }).click();
    await expect(marco.getByText('Demande envoyée').first()).toBeVisible();
    await marco.reload();
    await ready(marco);
    await expect(clanRow()).toContainText('Demande envoyée');

    // Le chef accepte la demande, puis nomme le nouveau membre officier.
    const requests = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /Demandes d.adhésion/ }) });
    const members = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Membres' }) });
    await page.reload();
    await ready(page);
    await expect(requests).toContainText('Marco');
    await requests.getByRole('button', { name: 'Accepter' }).click();
    // Attendre que la demande ait disparu : recharger aussitôt après le clic pouvait couper
    // l'envoi du formulaire, et Marco n'était alors jamais accepté.
    await expect(requests).toHaveCount(0);
    await page.reload();
    await ready(page);
    await expect(requests).toHaveCount(0);
    const marcoRow = () => members.getByRole('listitem').filter({ hasText: 'Marco' });
    await expect(marcoRow()).toBeVisible();
    await marcoRow().getByRole('button', { name: 'Nommer officier' }).click();
    await expect(marcoRow()).toContainText('Officier');

    // Un officier reçoit et accepte à son tour une demande.
    const leaContext = await browser.newContext();
    const lea = await leaContext.newPage();
    await lea.goto('/auth/dev?compte=lea');
    await leaveAnyClan(lea);
    await lea.goto('/clans');
    await ready(lea);
    await lea
      .getByRole('listitem')
      .filter({ hasText: name })
      .getByRole('button', { name: 'Demander à rejoindre' })
      .click();
    await expect(lea.getByText('Demande envoyée').first()).toBeVisible();

    await marco.goto('/clan');
    await ready(marco);
    const officerRequests = marco
      .locator('section')
      .filter({ has: marco.getByRole('heading', { name: /Demandes d.adhésion/ }) });
    await expect(officerRequests).toContainText('Léa');
    await officerRequests.getByRole('button', { name: 'Accepter' }).click();
    // Même précaution : la demande doit être traitée avant de quitter la page.
    await expect(officerRequests).toHaveCount(0);
    await marco.goto('/clan');
    await ready(marco);
    const marcoMembers = marco
      .locator('section')
      .filter({ has: marco.getByRole('heading', { name: 'Membres' }) });
    await expect(marcoMembers.getByRole('listitem').filter({ hasText: 'Léa' })).toBeVisible();
    // L'officier ne nomme pas : ce pouvoir reste au chef seul.
    await expect(marco.getByRole('button', { name: 'Nommer officier' })).toHaveCount(0);

    await marcoContext.close();
    await leaContext.close();
  });
});
