import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test, login, ready } from './helpers';

/**
 * Rien ne remplace une relecture humaine, mais ces règles attrapent les régressions évidentes :
 * un bouton sans nom, un contraste tombé sous le seuil, un champ sans étiquette.
 */
const audit = async (page: Page) => {
  await ready(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.nodes.length}) : ${violation.nodes[0]?.target.join(' ')} — ${violation.help}`,
  );
};

test.describe('accessibilité', () => {
  test('l’accueil se lit sans obstacle', async ({ page }) => {
    await page.goto('/');
    expect(await audit(page)).toEqual([]);
  });

  test('le profil d’un joueur se lit sans obstacle', async ({ page }) => {
    await page.goto('/u/lea');
    expect(await audit(page)).toEqual([]);
  });

  test('la page d’un jeu se lit sans obstacle', async ({ page }) => {
    await page.goto('/jeux/hades');
    expect(await audit(page)).toEqual([]);
  });

  test('le compte se règle sans obstacle', async ({ page }) => {
    await login(page);
    await page.goto('/compte');
    expect(await audit(page)).toEqual([]);
  });
});
