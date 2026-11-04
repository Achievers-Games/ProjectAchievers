import { expect } from '@playwright/test';
import { test } from './helpers';

test('montre le podium et le classement complet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Classement complet' }).last().click();
  await expect(page).toHaveURL(/classement/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Classement');
});
