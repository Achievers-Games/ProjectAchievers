import { expect } from '@playwright/test';
import { SITE_TOTAL } from '../src/lib/site-achievements';
import { test, login, ready } from './helpers';

test.describe('succès du site', () => {
  test('le tableau montre tous les succès et cache les secrets', async ({ page }) => {
    await login(page);
    await page.goto('/compte');
    const handle = await page.locator('input[name="handle"]').inputValue();
    await page.goto(`/u/${handle}`);
    await page.getByRole('link', { name: new RegExp(`/${SITE_TOTAL}$`) }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Les paliers d'un même succès ne font qu'une carte : le compte est écrit ici, sans passer
    // par le regroupement qui produit la page. Ajouter un succès le met à jour.
    await expect(page.locator('main li.card')).toHaveCount(203);
    await expect(page.locator('main section').last().locator('li.card')).toHaveCount(30);

    await expect(async () => {
      await page.reload();
      await expect(page.locator('main li details').first()).toBeVisible({ timeout: 1000 });
    }).toPass();
    await ready(page);
    const withdrawal = page.locator('li[data-codes~="withdrawal"]');
    await withdrawal.getByRole('button', { name: /après 30 jours/ }).click();
    await expect(withdrawal.locator('[aria-live="polite"]')).toContainText('30 jours');
    // Un premier échec, comme pendant un redéploiement : « Réessayer » relance la demande.
    // Une réponse illisible plutôt qu'une coupure, qui journaliserait une erreur réseau.
    let failed = false;
    await page.route('**/api/succes/suggestions**', (route) =>
      failed ? route.continue() : ((failed = true), route.fulfill({ body: 'Bad Gateway' })),
    );
    const proof = page.locator('main li details').first();
    await proof.locator('summary').click();
    await expect(proof.getByRole('link').first()).toBeVisible();

    // Une carte à viser propose des jeux pour y arriver.
    const next = page.locator('#ach-cards li details').first();
    await next.getByRole('button', { name: 'Réessayer' }).click();
    await expect(next.getByTestId('ach-ideas')).toContainText(/%|Aucun jeu/);

    // Les filtres et les sections repliables.
    const earned = await page.locator('main li.card:not(.opacity-70)').count();
    await page.getByRole('button', { name: 'Obtenus' }).click();
    await expect(page.locator('main li.card')).toHaveCount(earned);
    await page.getByRole('button', { name: 'Tous' }).click();
    const first = page.locator('main section').first();
    await first.locator('summary').first().click();
    await expect(first.locator('li.card').first()).toBeHidden();
  });
});
