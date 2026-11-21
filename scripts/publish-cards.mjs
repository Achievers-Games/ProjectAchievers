// Publie les cartes du catalogue : chaque dossier d'atelier (`static/_proto/<dossier>`) est copié,
// sans ses fichiers de fabrication, dans `<CARDS_DIR>/<dossier>/<version>/`, l'adresse que la base
// enregistre. Une version publiée n'est jamais réécrite (le cache la garde un an) : retoucher une
// carte, c'est incrémenter `version` dans `src/lib/card-catalogue.json`, puis republier.
//
//   node scripts/publish-cards.mjs            → ./cards, le dossier servi en développement
//   CARDS_DIR=/chemin node scripts/publish-cards.mjs
//   node scripts/publish-cards.mjs --force    → réécrit aussi les versions déjà publiées
//
// Chaque carte publiée reçoit aussi `thumb.webp`, sa miniature pour les grilles (460 px de large),
// calculée à partir de `full.jpg` par le Chromium de Playwright.
//
// Sur le NAS, `scripts/nas-cards.sh` envoie ensuite le dossier ./cards.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { servedFiles, WORKSHOP_DIR } from './card-files.mjs';

const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const target = process.env.CARDS_DIR ?? join(root, 'cards');
const force = process.argv.includes('--force');
const { games } = JSON.parse(readFileSync(join(root, 'src/lib/card-catalogue.json'), 'utf8'));

/** Le moteur partagé, importé par `../shared/…` depuis l'atelier : copié dans la carte publiée. */
const SHARED = 'shared';
const SHARED_IMPORT = /(['"`])\.\.\/shared\//g;
const SHARED_FILE = /['"`]\.\.\/shared\/([\w.-]+\.js)['"`]/g;

/** La largeur des miniatures : deux fois la tuile de la collection, nette sur un écran dense. */
const THUMB_WIDTH = 460;
let browser;
async function thumbnail(source, out) {
  browser ??= await chromium.launch();
  const page = await browser.newPage();
  const data = await page.evaluate(
    async ({ src, width }) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round((image.height * width) / image.width);
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', 0.8);
    },
    {
      src: `data:image/jpeg;base64,${readFileSync(source).toString('base64')}`,
      width: THUMB_WIDTH,
    },
  );
  await page.close();
  writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
}

async function publish(folder, version) {
  const source = join(root, WORKSHOP_DIR, folder);
  if (!existsSync(source)) throw new Error(`Dossier d'atelier introuvable : ${source}`);
  const dest = join(target, folder, String(version));
  if (existsSync(dest) && !force) return 'déjà publiée';

  // Écrit à côté puis renomme : une carte à moitié copiée n'est jamais servie.
  const staging = `${dest}.partiel`;
  rmSync(staging, { recursive: true, force: true });
  for (const file of servedFiles(source)) {
    mkdirSync(dirname(join(staging, file)), { recursive: true });
    cpSync(join(source, file), join(staging, file));
  }
  const script = join(staging, 'cards.js');
  if (existsSync(script)) {
    const code = readFileSync(script, 'utf8');
    // Seuls les modules du moteur que la carte importe la suivent, pas les pages de l'atelier.
    const imported = [...new Set([...code.matchAll(SHARED_FILE)].map((match) => match[1]))];
    if (imported.length) {
      writeFileSync(script, code.replace(SHARED_IMPORT, '$1./shared/'));
      mkdirSync(join(staging, SHARED), { recursive: true });
      for (const file of imported) {
        cpSync(join(root, WORKSHOP_DIR, SHARED, file), join(staging, SHARED, file));
      }
    }
  }
  if (existsSync(join(staging, 'full.jpg'))) {
    await thumbnail(join(staging, 'full.jpg'), join(staging, 'thumb.webp'));
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  try {
    renameSync(staging, dest);
  } catch {
    // Windows peut garder un fichier tout juste écrit verrouillé (antivirus) : on copie.
    cpSync(staging, dest, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
  }
  return 'publiée';
}

let published = 0;
for (const game of games) {
  for (const folder of new Set(Object.values(game.editions))) {
    const result = await publish(folder, game.version);
    if (result === 'publiée') published++;
    console.log(`${game.name} · ${folder}/${game.version} : ${result}`);
  }
}
console.log(`${published} dossier(s) publié(s) dans ${target}`);
await browser?.close();
