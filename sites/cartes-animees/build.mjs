// Assemble le site de partage des cartes animées dans dist/, depuis static/_proto.
// Exécution : node sites/cartes-animees/build.mjs
// Seuls les fichiers servis par les pages sont copiés : pas de sources, scripts de préparation
// ni essais intermédiaires.
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const proto = join(here, '../../static/_proto');
const dist = join(here, 'dist');

const files = {
  '.': ['index.html'],
  shared: ['site.css', 'inter.woff2', 'cinzel.woff2'],
  hades: ['index.html', 'cards.js', 'full.jpg', 'bg.jpg', 'bg-depth.png', 'fg.png', 'zagreus-body.png', 'zagreus-sword.png'],
  'hollow-knight': ['index.html', 'cards.js', 'full.jpg', 'bg-far.jpg', 'bg-depth.png', 'legs.png', 'nail.png',
    'head.png', 'cloak.png', 'platform.png', 'thorns.png'],
  ori: ['index.html', 'cards.js', 'full.jpg', 'bg.jpg', 'depth.png', 'branch.png', 'ku.png', 'ori.png', 'front.png'],
};

rmSync(dist, { recursive: true, force: true });
let count = 0, bytes = 0;
for (const [folder, names] of Object.entries(files)) {
  mkdirSync(join(dist, folder), { recursive: true });
  for (const name of names) {
    const from = join(proto, folder, name);
    cpSync(from, join(dist, folder, name));
    count++;
    bytes += statSync(from).size;
  }
}
console.log(`Site prêt dans ${dist} : ${count} fichiers, ${(bytes / 1024 / 1024).toFixed(1)} Mo.`);
