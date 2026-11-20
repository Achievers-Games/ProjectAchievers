import { chromium, expect } from '@playwright/test';

// Verify the complete SvelteKit app and its real hydration, not just an isolated component.
// Only the development demo is exercised: no booster or currency is spent.
const baseURL = process.env.BOOSTER_TEST_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: 'fr-FR',
    deviceScaleFactor: 2,
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  const messageRequests = new Set();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/messages/')) messageRequests.add(request.url());
  });
  const started = Date.now();
  await page.goto(`${baseURL}/dev/boosters`);
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await page.getByRole('button', { name: 'Une Mythique', exact: true }).click();
  await expect(page.locator('.pack')).toBeVisible({ timeout: 5000 });
  console.log(
    `Live page interactive in ${Date.now() - started}ms; ${messageRequests.size} translation modules`,
  );
  expect(messageRequests.size).toBeLessThan(100);
  const pack = page.locator('.pack');
  await pack.evaluate((node) => {
    node.style.animation = 'none';
  });
  const box = await pack.boundingBox();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95 + 8, box.y + box.height * 0.2 + 85, { steps: 8 });
  const fold = await page.locator('.pack-fold').boundingBox();
  expect(fold.x + fold.width).toBeGreaterThan(box.x + box.width + 3);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await page.screenshot({ path: 'design/brand/card-backs/live-fold-curved.png' });
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.2 + 200, { steps: 15 });
  await page.mouse.up();
  await expect(page.locator('.slot')).toHaveCount(5);
  await expect(page.locator('.pack.unpacking')).toBeVisible();
  await page.waitForTimeout(450);
  const emerging = await page.locator('.slot').first().boundingBox();
  expect(emerging.x + emerging.width).toBeGreaterThan(box.x + box.width);
  await page.screenshot({ path: 'design/brand/card-backs/live-packet-extraction.png' });
  await expect(page.locator('.pack')).toHaveCount(0);
  await expect(page.locator('.card').first()).toBeEnabled();
  await page.getByRole('button', { name: 'Tout retourner', exact: true }).click();
  await expect(page.locator('.mythique')).toHaveAttribute('data-phase', 'charge', {
    timeout: 15000,
  });
  await page.locator('.hero').click({ force: true });
  await expect(page.locator('.mythique')).toHaveAttribute('data-phase', 'burst');
  await page.locator('.mythique-text button').click();
  await expect(page.locator('.collection-recap')).toBeVisible();
  await expect(page.locator('.card.revealed')).toHaveCount(5);
  await expect(page.locator('.collection-mini')).toHaveCount(4);
  await expect(page.locator('.cards canvas[data-ready]')).toHaveCount(5, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const hoverCard = page.locator('.slot').first();
  const hoverBox = await hoverCard.boundingBox();
  for (const side of [0.02, 0.98, 0.02, 0.98]) {
    await page.mouse.move(hoverBox.x + hoverBox.width * side, hoverBox.y + hoverBox.height * 0.35, {
      steps: 12,
    });
    await page.waitForTimeout(350);
    const motion = await hoverCard.evaluate((node) => ({
      tilt: parseFloat(node.style.getPropertyValue('--tilt-y')),
      look: parseFloat(node.style.getPropertyValue('--look-x')),
      transition: getComputedStyle(node.querySelector('.tilt-surface')).transitionDuration,
    }));
    expect(Math.abs(motion.tilt)).toBeLessThanOrEqual(7.01);
    expect(Math.abs(motion.look)).toBeLessThanOrEqual(0.601);
    expect(motion.transition).toBe('0s');
    expect(side < 0.5 ? motion.tilt < 0 : motion.tilt > 0).toBe(true);
  }
  const steady = await hoverCard.evaluate(async (node) => {
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(parseFloat(node.style.getPropertyValue('--tilt-y')));
    }
    return Math.max(...samples) - Math.min(...samples);
  });
  expect(steady).toBeLessThan(0.1);
  const canvasScale = await page
    .locator('.cards canvas[data-ready]')
    .first()
    .evaluate((canvas) => canvas.width / canvas.clientWidth);
  expect(canvasScale).toBeLessThanOrEqual(1.51);
  await page.mouse.move(0, 0);
  await expect(hoverCard).not.toHaveAttribute('data-tilting');
  expect(await hoverCard.evaluate((node) => node.style.getPropertyValue('--tilt-y'))).toBe('0deg');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'design/brand/card-backs/live-opening-verified.png' });
  const gridCanvas = await hoverCard.locator('canvas').elementHandle();
  await page.locator('.card').first().click();
  const inspection = page.locator('.inspection-dialog');
  await expect(inspection).toBeVisible();
  await expect(inspection.locator('canvas[data-ready]')).toHaveCount(1, { timeout: 15000 });
  const inspectionWidth = await inspection.locator('.inspection-plane').boundingBox();
  expect(inspectionWidth.width).toBeGreaterThan(hoverBox.width * 2);
  await inspection.locator('canvas').evaluate((node) => {
    node.dataset.replays = '0';
    node.addEventListener('achievers:card-replay', () => {
      node.dataset.replays = String(Number(node.dataset.replays) + 1);
    });
  });
  await inspection.getByRole('button', { name: 'Rejouer l’animation', exact: true }).click();
  expect(await inspection.locator('canvas').evaluate((node) => node.dataset.replays)).toBe('1');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'design/brand/card-backs/inspection-front.png' });
  await inspection.getByRole('button', { name: 'Voir le dos', exact: true }).click();
  await expect(inspection.locator('.inspection-flipper')).toHaveClass(/show-back/);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'design/brand/card-backs/inspection-back.png' });
  await page.keyboard.press('ArrowRight');
  await expect(inspection.locator('.inspection-heading h2')).toHaveText('Hollow Knight');
  await expect(inspection.locator('.inspection-flipper')).not.toHaveClass(/show-back/);
  await page.keyboard.press('ArrowLeft');
  await expect(inspection.locator('.inspection-heading h2')).toHaveText('Hades');
  await page.keyboard.press('Escape');
  await expect(inspection).toHaveCount(0);
  await expect(page.locator('.card').first()).toBeFocused();
  expect(await gridCanvas.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.locator('.collection-recap')).toBeVisible();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    locale: 'fr-FR',
    hasTouch: true,
    isMobile: true,
  });
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(`${baseURL}/dev/boosters`);
  await mobile.waitForLoadState('networkidle');
  await mobile.getByRole('button', { name: 'Cinq Relief', exact: true }).click();
  await mobile.locator('.pack').click({ force: true });
  await expect(mobile.locator('.pack.unpacking')).toBeVisible();
  await expect(mobile.locator('.slot')).toHaveCount(5);
  await expect(mobile.locator('.pack')).toHaveCount(0);
  await expect(mobile.locator('.card').first()).toBeEnabled();
  for (const card of await mobile.locator('.card').all()) {
    const placed = await card.boundingBox();
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.x + placed.width).toBeLessThanOrEqual(391);
  }
  await mobile.locator('.card').first().click();
  await expect(mobile.locator('.card').first()).toBeEnabled();
  await mobile.locator('.card').first().click();
  const mobileInspection = mobile.locator('.inspection-dialog');
  await expect(mobileInspection).toBeVisible();
  const detailBox = await mobileInspection.locator('.inspection-plane').boundingBox();
  expect(detailBox.x).toBeGreaterThanOrEqual(0);
  expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(391);
  await mobile.screenshot({ path: 'design/brand/card-backs/inspection-mobile.png' });
  await mobileInspection.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(mobileInspection).toHaveCount(0);
  expect(errors).toEqual([]);
  await mobile.close();
  const manual = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: 'fr-FR',
  });
  manual.setDefaultTimeout(15000);
  manual.on('pageerror', (error) => errors.push(error.message));
  await manual.goto(`${baseURL}/dev/boosters`);
  await manual.waitForLoadState('networkidle');
  await manual.getByRole('button', { name: 'Une Mythique', exact: true }).click();
  await manual.locator('.pack').click({ force: true });
  const manualCards = manual.locator('.card');
  await expect(manualCards.nth(3)).toBeEnabled();
  await manualCards.nth(3).click();
  await expect(manualCards.nth(3)).toHaveClass(/charging/);
  await expect(manualCards.first()).toBeEnabled();
  await manualCards.first().click();
  await expect(manualCards.nth(2)).toBeEnabled();
  await manualCards.nth(4).click({ force: true });
  await expect(manual.locator('.mythique')).toBeVisible();
  await expect(manualCards.nth(3)).toHaveClass(/revealed/);
  const keptCanvas = await manualCards.first().locator('canvas').elementHandle();
  await manual.locator('.hero').click({ force: true });
  await manual.locator('.mythique-text button').click();
  await expect(manual.locator('.card.revealed')).toHaveCount(3);
  expect(await keptCanvas.evaluate((node) => node.isConnected)).toBe(true);
  await expect(manualCards.nth(1)).toBeEnabled();
  await manualCards.nth(1).click();
  await expect(manualCards.nth(2)).toBeEnabled();
  await manualCards.nth(2).click();
  await keptCanvas.evaluate((node) => {
    node.dataset.replays = '0';
    node.addEventListener('achievers:card-replay', () => {
      node.dataset.replays = String(Number(node.dataset.replays) + 1);
    });
  });
  await expect(manualCards.first()).toBeEnabled();
  await manualCards.first().click();
  await expect(manual.locator('.inspection-dialog')).toBeVisible();
  await manual
    .locator('.inspection-dialog')
    .getByRole('button', { name: 'Rejouer l’animation', exact: true })
    .click();
  expect(await keptCanvas.evaluate((node) => node.dataset.replays)).toBe('0');
  await manual.keyboard.press('Escape');
  expect(await keptCanvas.evaluate((node) => node.isConnected)).toBe(true);
  await expect(manual.locator('.collection-recap')).toBeVisible();
  const unchangedSummary = await manual.locator('.summary').innerText();
  await expect(manualCards.nth(4)).toBeEnabled();
  await manualCards.nth(4).click({ force: true });
  await expect(manual.locator('.inspection-dialog')).toBeVisible();
  await manual
    .locator('.inspection-dialog')
    .getByRole('button', { name: 'Revoir la révélation', exact: true })
    .click();
  await expect(manual.locator('.mythique')).toHaveAttribute('data-phase', 'charge');
  await manual.locator('.hero').click({ force: true });
  await manual.locator('.mythique-text button').click();
  await expect(manual.locator('.summary')).toHaveText(unchangedSummary);
  expect(await keptCanvas.evaluate((node) => node.isConnected)).toBe(true);
  expect(errors).toEqual([]);
  await manual.close();
  console.log(
    'PASS: real app hydration, scenario buttons, downward tear, sequential reveal, Mythique and collection',
  );
} finally {
  await browser.close();
}
