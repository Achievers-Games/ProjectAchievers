import { expect } from '@playwright/test';
import { test, login, ready } from './helpers';

/** Les pages que les parcours ne croisaient jamais : elles cassent sans que rien ne le signale. */
test.describe('pages délaissées', () => {
  test('un visiteur trouve la connexion et la politique de confidentialité', async ({ page }) => {
    await page.goto('/connexion');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion');
    // Le compte de démonstration n'existe qu'en développement.
    await expect(page.locator('a[href="/auth/dev"]')).toBeVisible();
    // Le pied de page porte aussi ce lien : on suit celui de la page.
    await page.locator('main').getByRole('link', { name: 'Confidentialité' }).click();
    await expect(page).toHaveURL(/confidentialite/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confidentialité');
    await expect(page.locator('a[href="/compte"]')).toBeVisible();
  });

  test('la page de contact propose le formulaire ou explique son absence', async ({ page }) => {
    await page.goto('/contact');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contact');
    const form = page.locator('form');
    if (await form.isVisible()) {
      await expect(page.getByLabel('Ton nom')).toBeVisible();
      await expect(page.getByLabel('Ton adresse email')).toBeVisible();
      await expect(page.getByLabel('Ton message')).toBeVisible();
    } else {
      await expect(page.locator('main p.card')).toBeVisible();
    }
  });

  test('affiche le tableau des succès du site d’un profil', async ({ page }) => {
    await page.goto('/u/lea/succes');
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Succès du site');
    await expect(page.locator('main li.card').first()).toBeVisible();
    // Le filtre « Obtenus » ne garde que ce que le joueur possède.
    const earned = await page.locator('main li.card:not(.opacity-70)').count();
    await page.getByRole('button', { name: 'Obtenus' }).click();
    await expect(page.locator('main li.card')).toHaveCount(earned);
  });

  test('ouvre la fiche d’un succès depuis sa page de jeu', async ({ page }) => {
    await page.goto('/jeux/hades');
    await ready(page);
    const link = page.locator('main a[href^="/succes/"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/succes\/./);
    await ready(page);
    // Un succès caché garde son nom masqué, d'où une simple vérification de contenu.
    await expect(page.getByRole('heading', { level: 1 })).not.toBeEmpty();
    await expect(page.getByRole('heading', { name: 'Discussion' })).toBeVisible();
  });

  test('ouvre une discussion depuis la liste des messages', async ({ page, browser }) => {
    await login(page);
    await page.goto('/messages');
    await ready(page);
    if ((await page.locator('main a[href^="/messages/"]').count()) === 0) {
      // Aucune discussion encore : on s'en crée une avec Léa. L'amitié peut déjà exister
      // d'un test précédent, comme la demande peut attendre : on ne fait que ce qui manque.
      await page.goto('/u/lea');
      await ready(page);
      const add = page.getByRole('button', { name: 'Ajouter' });
      if (await add.isVisible()) await add.click();

      const other = await browser.newContext();
      const friend = await other.newPage();
      await friend.goto('/auth/dev?compte=lea');
      await friend.goto('/amis');
      await ready(friend);
      const accept = friend.getByRole('button', { name: 'Accepter' }).first();
      if (await accept.isVisible()) await accept.click();
      await other.close();

      // Depuis la fiche, « Message » ouvre la discussion et mène directement dedans.
      await page.goto('/u/lea');
      await ready(page);
      await page.getByRole('button', { name: 'Message' }).click();
      await expect(page).toHaveURL(/\/messages\/./);
      await ready(page);
      await page.goto('/messages');
      await ready(page);
    }

    const conversation = page.locator('main a[href^="/messages/"]').first();
    await expect(conversation).toBeVisible();
    await conversation.click();
    await expect(page).toHaveURL(/\/messages\/./);
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).not.toBeEmpty();
    await expect(page.getByLabel('Écris un message…')).toBeVisible();
    await page.getByRole('link', { name: 'Messages' }).first().click();
    await expect(page).toHaveURL(/\/messages$/);
  });

  test('ouvre la page publique d’un clan', async ({ page }) => {
    await login(page);
    await page.goto('/clan');
    await ready(page);
    // Le joueur de test peut déjà avoir un clan : on en repart pour repasser par la création.
    const leave = page.getByRole('button', { name: 'Quitter le clan' });
    if (await leave.isVisible()) await leave.click();
    await page.getByLabel('Nom du clan').fill(`Clan page ${Date.now()}`);
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page.getByRole('link', { name: 'Page publique' })).toBeVisible();

    await page.goto('/clans');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const clan = page.locator('main a[href^="/clans/"]').first();
    await expect(clan).toBeVisible();
    const name = (await clan.locator('span.block.truncate.font-medium').textContent())?.trim();
    await clan.click();
    await expect(page).toHaveURL(/\/clans\/./);
    if (name) await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
    await expect(page.getByRole('heading', { name: 'Membres' })).toBeVisible();
  });

  test('compare deux profils par leurs adresses', async ({ page }) => {
    await page.goto('/comparer?a=demo&b=lea');
    await expect(page.getByRole('heading', { name: /Jeux en commun/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
