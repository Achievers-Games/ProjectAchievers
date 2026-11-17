import { expect, test as base, type Page } from '@playwright/test';

/** Tout test échoue si la page journalise une erreur : un écran vide ne passe plus inaperçu. */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const location = message.location().url;
        // Les images distantes dépendent du réseau, pas de l'application.
        if (location.includes('steamstatic.com')) return;
        // En développement, Vite sert ses propres modules depuis `.svelte-kit/generated/` :
        // une page qui en redemande un pendant une régénération reçoit un 404 qui ne vient
        // pas du site et qui n'existe pas une fois compilé.
        if (location.includes('/.svelte-kit/generated/') && message.text().includes('404')) return;
        // Depuis SvelteKit 3, une action part en `fetch` : un échec de validation voulu (`fail(400)`)
        // apparaît aussi comme une requête en erreur dans la console.
        if (location.includes('?/') && message.text().startsWith('Failed to load resource')) return;
        errors.push(`${message.text()} (${location})`);
      });
      await use();
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export const login = (page: Page) => page.goto('/auth/dev');

/** Attend que Svelte ait pris la main sur le HTML rendu par le serveur. */
export const ready = (page: Page) =>
  page.locator('html[data-ready="true"]').waitFor({ state: 'attached' });

/**
 * Ferme les succès qui se fêtent à l'écran : ils arrivent quand ils veulent, en bas au centre, et
 * recouvrent parfois le bouton que le test doit cliquer. Plusieurs : « Tout fermer » ; un seul :
 * un clic dessus le range.
 */
export async function closePops(page: Page) {
  for (let tries = 0; tries < 5; tries++) {
    const all = page.locator('.pop-zone .close-all');
    const pop = page.locator('.pop-zone .pop').first();
    if (await all.isVisible()) await all.click();
    else if (await pop.isVisible()) await pop.click();
    else return;
  }
}
