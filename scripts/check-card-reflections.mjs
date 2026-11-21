import { createServer } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';

// Exercise the real booster component in a browser without starting database workers.
const server = await createServer({
  configFile: false,
  publicDir: 'static',
  cacheDir: 'node_modules/.vite-card-check',
  plugins: [
    {
      name: 'card-check-entry',
      resolveId(id) {
        if (id === '/card-check-entry.js') return '\0card-check-entry';
      },
      load(id) {
        if (id === '\0card-check-entry')
          return `import { mount } from 'svelte';
        import App from '/src/routes/dev/boosters/+page.svelte';
        import Booster from '/src/lib/components/BoosterReveal.svelte';
        const fixture = new URLSearchParams(location.search).get('fixture');
        const cards = ['Alpha', 'Beta', 'Gamma'].map((name, i) => ({
          game: { name, headerUrl: null }, duplicate: fixture === 'duplicates', shards: fixture === 'duplicates' ? 3 : 0,
          kind: fixture === 'multi' && i > 0 ? 'MYTHIQUE' : i === 1 ? 'VIVANTE' : 'RELIEF',
        }));
        mount(fixture ? Booster : App, {target: document.getElementById('app'),
          props: fixture ? { cards, kind: 'NORMAL', onclose() {} } : {}});`;
      },
    },
    svelte({ configFile: false, preprocess: vitePreprocess() }),
  ],
  resolve: { alias: { '#lib': resolve('src/lib') } },
  server: {
    host: '127.0.0.1',
    port: 5185,
    strictPort: true,
    watch: { ignored: ['**/design/brand/**', '**/src/lib/paraglide/**'] },
  },
  appType: 'custom',
});
server.middlewares.use((req, res, next) => {
  if (req.url?.split('?')[0] !== '/') return next();
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#101017;color:white;font:16px sans-serif">
    <div id="app"></div><script type="module" src="/card-check-entry.js"></script></body></html>`);
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) console.log(r.status(), r.url());
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(msg.text());
  });
  await page.goto('http://127.0.0.1:5185/');
  await page.waitForTimeout(1500);
  if (errors.length) throw new Error(errors.join('\n'));
  await page.getByRole('button', { name: 'Une Mythique', exact: true }).click();
  const pack = page.locator('.pack');
  const packBox = await pack.boundingBox();
  expect(packBox.width / packBox.height).toBeCloseTo(2, 1);
  await pack.hover({ position: { x: 150, y: 100 }, force: true });
  await expect(pack).toHaveAttribute('data-tilting', '');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'design/brand/card-backs/pack-horizontal-preview.png' });
  // Freeze the idle float while testing precise pointer distances, not the interactive surface.
  await pack.evaluate((el) => {
    el.style.animation = 'none';
  });
  // An incomplete pull must not accidentally trigger the click-to-open fallback.
  let pull = await pack.boundingBox();
  await page.mouse.move(pull.x + pull.width * 0.95, pull.y + pull.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(pull.x + pull.width * 0.95, pull.y + pull.height * 0.2 + 15, { steps: 4 });
  await expect(pack).toHaveAttribute('data-dragging', '');
  await page.mouse.up();
  await expect(pack).not.toHaveClass(/tearing/);
  await expect(page.locator('.slot')).toHaveCount(0);
  pull = await pack.boundingBox();
  await page.mouse.move(pull.x + pull.width * 0.95, pull.y + pull.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(pull.x + pull.width * 0.95, pull.y + pull.height * 0.2 + 85, { steps: 10 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'design/brand/card-backs/pack-fold-preview.png' });
  const folded = await page.locator('.pack-fold').boundingBox();
  expect(folded.height).toBeGreaterThan(50);
  expect(folded.x + folded.width).toBeGreaterThan(pull.x + pull.width + 3);
  await page.mouse.move(pull.x + pull.width * 0.95, pull.y + pull.height * 0.2 + 200, {
    steps: 10,
  });
  await expect(pack).toHaveAttribute('data-dragging', '');
  await expect.poll(() => pack.evaluate((el) => el.style.getPropertyValue('--peel'))).toBe('0.62');
  await page.mouse.up();
  await expect(page.locator('.slot')).toHaveCount(5);
  await expect(page.locator('.pack')).toHaveCount(0);
  await expect(page.locator('.card').first()).toBeEnabled();
  await page
    .locator('.card-back img')
    .first()
    .evaluate((img) => img.decode());
  const slot = page.locator('.slot').nth(3);
  const box = await slot.boundingBox();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
  await expect(slot).toHaveAttribute('data-tilting', '');
  await expect.poll(() => slot.evaluate((el) => el.style.getPropertyValue('--shine'))).toBe('1');
  const firstTilt = await slot.evaluate((el) => el.style.getPropertyValue('--tilt-y'));
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await expect
    .poll(() => slot.evaluate((el) => el.style.getPropertyValue('--tilt-y')))
    .not.toBe(firstTilt);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'design/brand/card-backs/interaction-preview.png' });
  await page.mouse.move(0, 0);
  await expect(slot).not.toHaveAttribute('data-tilting');
  await page.locator('.card').first().click();
  await expect(page.locator('.card').first()).toHaveClass(/revealed/);
  await expect(page.locator('.card').nth(4)).toBeEnabled();
  await page.locator('.card').nth(4).click({ force: true });
  await expect(page.locator('.mythique')).toBeVisible();
  await page.locator('.hero').hover({ position: { x: 100, y: 80 } });
  await expect(page.locator('.hero')).toHaveAttribute('data-tilting', '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.hero')).not.toHaveAttribute('data-tilting');
  await page.locator('.hero').hover();
  await expect(page.locator('.hero')).not.toHaveAttribute('data-tilting');
  await page.locator('.hero').click({ force: true });
  await expect(page.locator('.mythique')).toHaveAttribute('data-phase', 'burst');
  await expect(page.locator('.mythique')).toHaveAttribute('data-atmosphere', 'ash');
  await page.locator('.mythique-text button').click();
  await page.getByRole('button', { name: 'Tout retourner', exact: true }).click();
  await expect(page.locator('.collection-recap')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.collection-mini')).toHaveCount(4);
  await expect(page.locator('.slot.duplicate')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(900);
  await page.locator('.slot').first().hover();
  await page.screenshot({ path: 'design/brand/card-backs/fronts-collection-preview.png' });
  expect(errors).toEqual([]);
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  await mobile.goto('http://127.0.0.1:5185/');
  await mobile.getByRole('button', { name: 'Booster doré', exact: true }).click();
  const mobilePack = mobile.locator('.pack');
  await expect(mobilePack).toHaveAttribute('data-kind', 'golden');
  const mobileBox = await mobilePack.boundingBox();
  expect(mobileBox.width).toBeLessThan(390);
  expect(mobileBox.width / mobileBox.height).toBeCloseTo(2, 1);
  const touch = await mobile.context().newCDPSession(mobile);
  const tx = mobileBox.x + mobileBox.width * 0.95;
  const ty = mobileBox.y + mobileBox.height * 0.2;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: tx, y: ty, id: 1 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: tx, y: ty + 130, id: 1 }],
  });
  await expect(mobilePack).toHaveAttribute('data-dragging', '');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await expect(mobile.locator('.slot')).toHaveCount(5);
  await mobile.getByRole('button', { name: 'Tout retourner', exact: true }).click();
  await expect(mobile.locator('.collection-recap')).toBeVisible();
  await mobile.screenshot({ path: 'design/brand/card-backs/fronts-mobile-preview.png' });
  await mobile.close();
  const cinematic = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  cinematic.setDefaultTimeout(15000);
  await cinematic.goto('http://127.0.0.1:5185/');
  await cinematic.getByRole('button', { name: 'Une Mythique', exact: true }).click();
  await cinematic.locator('.pack').press('Enter');
  await expect(cinematic.locator('.slot')).toHaveCount(5);
  await cinematic.getByRole('button', { name: 'Tout retourner', exact: true }).click();
  await expect(cinematic.locator('.slot.spotlight')).toBeVisible({ timeout: 15000 });
  await expect(cinematic.locator('.mythique')).toHaveAttribute('data-phase', 'charge', {
    timeout: 10000,
  });
  await cinematic.locator('.hero').click({ force: true });
  await expect(cinematic.locator('.mythique')).toHaveAttribute('data-phase', 'burst');
  await cinematic.locator('.mythique-text button').click();
  await expect(cinematic.locator('.collection-recap')).toBeVisible();
  await expect(cinematic.locator('.card.revealed')).toHaveCount(5);
  await cinematic.close();
  for (const fixture of ['duplicates', 'multi']) {
    const edge = await browser.newPage({ reducedMotion: 'reduce' });
    edge.setDefaultTimeout(15000);
    edge.on('pageerror', (e) => errors.push(e.message));
    await edge.goto(`http://127.0.0.1:5185/?fixture=${fixture}`);
    await edge.locator('.pack').press('Enter');
    await edge.getByRole('button', { name: 'Tout retourner', exact: true }).click();
    if (fixture === 'multi') {
      await expect(edge.locator('.mythique-text .game')).toHaveText('Beta');
      await edge.locator('.mythique-text button').click();
      await expect(edge.locator('.mythique-text .game')).toHaveText('Gamma');
      await edge.locator('.mythique-text button').click();
      await expect(edge.locator('.collection-mini')).toHaveCount(3);
    } else {
      await expect(edge.locator('.empty-collection')).toBeVisible();
      await expect(edge.locator('.slot.duplicate')).toHaveCount(3);
      await expect(edge.locator('.shard-total')).toContainText('9');
    }
    await expect(edge.locator('.collection-recap')).toBeVisible();
    await edge.close();
  }
  expect(errors).toEqual([]);
  console.log(
    'PASS: drag/cancel/keyboard opening, lighting, fronts, serial reveal, suspense, game atmosphere, collection, mobile, reduced motion, duplicates and multiple Mythiques',
  );
} finally {
  await browser.close();
  await server.close();
}
