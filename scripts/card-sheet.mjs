// Planche de vérification d'une carte : des images de la boucle (ou de l'intro) à des instants
// choisis, côte à côte, pour juger un mouvement sans le regarder défiler. Lit la galerie du
// serveur de développement (`npm run dev`), donc la carte telle que le site la monte.
//
//   node scripts/card-sheet.mjs "Portal 2" Vivante
//   node scripts/card-sheet.mjs "Portal 2" Mythique --intro
//   node scripts/card-sheet.mjs "Portal 2" Vivante --no-vfx --joint arm --times 0,0.5,1.45,1.76
//   node scripts/card-sheet.mjs --folder portal-2 Vivante --look 1,-1
//
// `--folder <dossier>` monte directement un dossier de l'atelier : il sert avant l'entrée du jeu au
// catalogue. `--look x,y` pose le pointeur (de -1 à 1) pour contrôler les bords de la parallaxe.
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
const folder = option('folder');
const words = args.filter(
  (arg, index) =>
    !arg.startsWith('--') &&
    !args[index - 1]?.match(/^--(times|joint|cols|url|out|folder|look|width)$/),
);
const [name, edition] = folder ? [folder, words[0]] : words;
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
  option('joint') && `pivot-${option('joint').replaceAll(':', '-')}`,
  option('look') && `regard${option('look')}`,
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
  if (folder) {
    // Une page vide qui monte la carte comme le site : `dialog` garde le même sélecteur.
    await page.goto(`${base}/_proto/shared/site.css`);
    await page.evaluate(
      async ({ folder, level, width, look }) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<dialog open style="position:fixed;inset:0;margin:0;padding:0;border:0"><div id="surface" style="width:${width}px;height:${Math.round((width * 215) / 460)}px"><canvas style="display:block;width:100%;height:100%"></canvas></div></dialog>`;
        const manifest = await (await fetch(`/_proto/${folder}/edition.json`)).json();
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `/_proto/${folder}/cards.js`;
          script.onload = resolve;
          script.onerror = reject;
          document.head.append(script);
        });
        await window.AchieversCards[manifest.id].mount(document.querySelector('canvas'), level);
        if (look) {
          const surface = document.getElementById('surface');
          const box = surface.getBoundingClientRect();
          surface.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: box.left + ((look[0] + 1) / 2) * box.width,
              clientY: box.top + ((look[1] + 1) / 2) * box.height,
            }),
          );
        }
      },
      {
        folder,
        level: edition === 'Relief' ? 2 : 3,
        width: Number(option('width', '920')),
        look: option('look')?.split(',').map(Number),
      },
    );
    await page.waitForTimeout(1500);
  } else {
    await page.goto(`${base}/dev/cartes-animees`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `Inspecter ${name} — ${edition}`, exact: true }).click();
    await page.locator('dialog[open] canvas[data-ready]').first().waitFor({ timeout: 30_000 });
  }
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
