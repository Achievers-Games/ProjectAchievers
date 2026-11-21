// Planche de vérification d'une carte : des images de la boucle (ou de l'intro) à des instants
// choisis, côte à côte, pour juger un mouvement sans le regarder défiler. Lit la galerie du
// serveur de développement (`npm run dev`), donc la carte telle que le site la monte.
//
//   node scripts/card-sheet.mjs "Portal 2" Vivante
//   node scripts/card-sheet.mjs "Portal 2" Mythique --intro
//   node scripts/card-sheet.mjs "Portal 2" Vivante --no-vfx --joint arm --times 0,0.5,1.45,1.76
//
// Options : --times a,b,c (secondes), --intro (fige l'intro au lieu de la boucle), --no-vfx,
// --joint <calque> (isole un pivot), --cols n, --url (autre serveur), --out fichier.jpg.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const flag = (name) => args.includes(`--${name}`);
const [name, edition] = args.filter(
  (arg, index) =>
    !arg.startsWith('--') && !args[index - 1]?.match(/^--(times|joint|cols|url|out)$/),
);
if (!name || !['Relief', 'Vivante', 'Mythique'].includes(edition)) {
  console.error(
    'Usage : node scripts/card-sheet.mjs "<jeu>" <Relief|Vivante|Mythique> [--intro] [--no-vfx] [--joint id] [--times a,b,c]',
  );
  process.exit(1);
}
const intro = flag('intro');
const times = (
  option('times') ??
  (intro ? '0.3,0.8,1.3,1.8,2.3,2.8,3.4,4,4.8' : '0,0.75,1.5,2.25,3,3.75,4.5,5.25,6')
)
  .split(',')
  .map(Number);
const cols = Number(option('cols', '3'));
const base = option('url', 'http://localhost:3000');
const slug = name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const suffix = [
  intro && 'intro',
  flag('no-vfx') && 'sans-vfx',
  option('joint') && `pivot-${option('joint')}`,
]
  .filter(Boolean)
  .join('-');
const out = option(
  'out',
  `cards-review/${slug}-${edition.toLowerCase()}${suffix ? `-${suffix}` : ''}.jpg`,
);

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/dev/cartes-animees`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: `Inspecter ${name} — ${edition}`, exact: true }).click();
  await page.locator('dialog[open] canvas[data-ready]').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const sheet = await page.evaluate(
    async ({ times, cols, intro, noVfx, joint }) => {
      // Le plus grand canvas de l'inspection : la carte, pas une vignette.
      const canvas = [...document.querySelectorAll('dialog[open] canvas')].sort(
        (a, b) => b.clientWidth - a.clientWidth,
      )[0];
      if (noVfx) canvas.dataset.cardEffects = 'off';
      if (joint) canvas.dataset.cardJoint = joint;
      const { width, height } = canvas;
      const out = document.createElement('canvas');
      out.width = width * Math.min(cols, times.length);
      out.height = height * Math.ceil(times.length / cols);
      const g = out.getContext('2d');
      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
      for (const [index, time] of times.entries()) {
        canvas.dataset[intro ? 'cardIntroTime' : 'cardTime'] = String(time);
        await frames();
        const x = (index % cols) * width;
        const y = Math.floor(index / cols) * height;
        g.drawImage(canvas, x, y);
        g.fillStyle = 'rgb(0 0 0 / 0.6)';
        g.fillRect(x, y, 90, 30);
        g.fillStyle = '#ffd84a';
        g.font = '20px sans-serif';
        g.fillText(`${time}s`, x + 8, y + 22);
      }
      return out.toDataURL('image/jpeg', 0.85);
    },
    { times, cols, intro, noVfx: flag('no-vfx'), joint: option('joint') },
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log(out);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
