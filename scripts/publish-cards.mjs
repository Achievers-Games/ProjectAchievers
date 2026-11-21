// Publie les cartes du catalogue : chaque dossier d'atelier (`static/_proto/<dossier>`) est copié,
// sans ses fichiers de fabrication, dans `<CARDS_DIR>/<dossier>/<version>/`, l'adresse que la base
// enregistre. Une version publiée n'est jamais réécrite (le cache la garde un an) : retoucher une
// carte, c'est incrémenter `version` dans `src/lib/card-catalogue.json`, puis republier.
//
//   node scripts/publish-cards.mjs            → ./cards, le dossier servi en développement
//   CARDS_DIR=/chemin node scripts/publish-cards.mjs
//   node scripts/publish-cards.mjs --force    → réécrit aussi les versions déjà publiées
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
import { servedFiles, WORKSHOP_DIR } from './card-files.mjs';

const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const target = process.env.CARDS_DIR ?? join(root, 'cards');
const force = process.argv.includes('--force');
const { games } = JSON.parse(readFileSync(join(root, 'src/lib/card-catalogue.json'), 'utf8'));

/** Le moteur partagé, importé par `../shared/…` depuis l'atelier : copié dans la carte publiée. */
const SHARED = 'shared';
const SHARED_IMPORT = /(['"`])\.\.\/shared\//g;

function publish(folder, version) {
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
    if (code.search(SHARED_IMPORT) !== -1) {
      writeFileSync(script, code.replace(SHARED_IMPORT, '$1./shared/'));
      const shared = join(root, WORKSHOP_DIR, SHARED);
      for (const file of servedFiles(shared)) {
        mkdirSync(dirname(join(staging, SHARED, file)), { recursive: true });
        cpSync(join(shared, file), join(staging, SHARED, file));
      }
    }
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
    const result = publish(folder, game.version);
    if (result === 'publiée') published++;
    console.log(`${game.name} · ${folder}/${game.version} : ${result}`);
  }
}
console.log(`${published} dossier(s) publié(s) dans ${target}`);
