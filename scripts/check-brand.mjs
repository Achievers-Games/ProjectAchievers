import { chromium, expect } from '@playwright/test';

const baseURL = process.env.BRAND_TEST_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseURL}/connexion`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('header .brand-logo')).toHaveCount(1);
  await expect(page.locator('footer .brand-logo')).toHaveCount(1);
  await expect(page.locator('header a[aria-label="Achievers"]')).toHaveAttribute('href', '/');
  const mask = await page
    .locator('header .brand-wordmark')
    .evaluate((node) => getComputedStyle(node).maskImage);
  expect(mask).toContain('/brand/achievers-wordmark.svg');
  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((node, theme) => {
      node.dataset.theme = theme;
    }, theme);
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const boxes = await page.locator('header').evaluate((header) => {
        const brand = header.querySelector('a[aria-label="Achievers"]').getBoundingClientRect();
        const actions = header.querySelector('.ml-auto').getBoundingClientRect();
        return {
          brandRight: brand.right,
          actionsLeft: actions.left,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      expect(boxes.overflow, `${theme} ${width}px overflows`).toBe(false);
      expect(boxes.brandRight).toBeLessThanOrEqual(boxes.actionsLeft);
      if (width === 320) await expect(page.locator('header .brand-symbol')).toBeVisible();
      else await expect(page.locator('header .brand-wordmark')).toBeVisible();
      if (width === 375 || width === 1440)
        await page.screenshot({
          path: `${process.env.TEMP}/achievers-brand-${theme}-${width}.png`,
          fullPage: true,
        });
    }
  }
  const svg = await page.request.get(`${baseURL}/favicon.svg`);
  expect(svg.ok()).toBe(true);
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  const manifest = await (await page.request.get(`${baseURL}/manifest.webmanifest`)).json();
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons)
    expect((await page.request.get(`${baseURL}${icon.src}`)).ok()).toBe(true);
  const shapes = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/brand/icon-maskable-512.png';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return { width: image.width, cornerAlpha: ctx.getImageData(0, 0, 1, 1).data[3] };
  });
  expect(shapes).toEqual({ width: 512, cornerAlpha: 255 });
  expect(errors).toEqual([]);
  console.log(
    'PASS: header/footer logos, accessible home link, dark/light at 320–1440px, favicon and installed-app icons.',
  );
} finally {
  await browser.close();
}
