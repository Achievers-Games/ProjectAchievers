import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Offline authoring step: derive reflective material masks from the approved artwork.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await mkdir('static/cards/backs', { recursive: true });
  for (const [edition, file] of [
    ['relief', '04-relief-v2.png'],
    ['vivante', '05-vivante-v2.png'],
    ['mythique', '06-mythique-v2.png'],
  ]) {
    const source = (await readFile(`design/brand/card-backs/${file}`)).toString('base64');
    const result = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 920;
      canvas.height = 430;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, 920, 430);
      const art = canvas.toDataURL('image/webp', 0.94).split(',')[1];
      const pixels = ctx.getImageData(0, 0, 920, 430);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const light = pixels.data[i] * 0.22 + pixels.data[i + 1] * 0.5 + pixels.data[i + 2] * 0.28;
        // Leave matte midnight areas untouched; graduated coverage follows metal and facets.
        const coverage = Math.max(0, Math.min(1, (light - 26) / 125));
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
        pixels.data[i + 3] = Math.round(255 * Math.pow(coverage, 0.8));
      }
      ctx.putImageData(pixels, 0, 0);
      return { art, mask: canvas.toDataURL('image/png').split(',')[1] };
    }, source);
    await writeFile(`static/cards/backs/${edition}.webp`, Buffer.from(result.art, 'base64'));
    await writeFile(`static/cards/backs/${edition}-metal.png`, Buffer.from(result.mask, 'base64'));
  }
} finally {
  await browser.close();
}
