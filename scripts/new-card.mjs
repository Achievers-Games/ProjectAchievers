// Prépare l'atelier d'un nouveau jeu : les deux dossiers (Relief et Vivante partagent le hero
// Steam, la Mythique a sa propre illustration), chacun avec son `cards.js` qui charge le moteur
// commun, une scène vide et son manifeste. Télécharge le hero Steam comme source.
//
//   node scripts/new-card.mjs celeste 504230
//
// Le jeu n'entre pas encore au catalogue : il y entre quand ses trois éditions passent les tests.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSHOP_DIR } from './card-files.mjs';

const [slug, steamAppId] = process.argv.slice(2);
if (!slug?.match(/^[a-z0-9]+(-[a-z0-9]+)*$/) || !steamAppId?.match(/^\d+$/)) {
  console.error('Usage : node scripts/new-card.mjs <dossier-en-kebab-case> <appid Steam>');
  process.exit(1);
}

const hero = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_hero.jpg`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const loader = (id) => `(() => {
  const folder = new URL('.', document.currentScript.src);
  let scene;
  (window.AchieversCards ??= {})['${id}'] = {
    async mount(canvas, level = 3) {
      const render = await (scene ??= import(new URL('../shared/card-engine.js', folder)).then(
        ({ loadCardScene }) => loadCardScene(folder),
      ));
      return render(canvas, level);
    },
  };
})();
`;
const scene = (source) => ({
  engine: 2,
  source,
  view: [0, 0, 1920, 620],
  period: 6,
  curves: { accent: [0.5, 1.4, 1.8, 3.2] },
  background: { file: 'bg.jpg', parallax: [-6, -3] },
  layers: [],
});

const folders = [
  {
    folder: slug,
    source: hero,
    edition: { id: slug, glow: '#9fd3ff', atmosphere: 'wisps', sound: null, shots: [] },
  },
  {
    folder: `${slug}-mythique`,
    source: null,
    edition: {
      id: `${slug}-mythique`,
      glow: '#ffc88a',
      atmosphere: 'wisps',
      sound: null,
      // Trajet de révélation gauche → droite → centre, fini à zoom 1 (voir le workflow).
      shots: [
        {
          from: { x: 0.08, y: 0.7, zoom: 1.75 },
          to: { x: 0.26, y: 0.55, zoom: 1.75 },
          duration: 1700,
        },
        {
          from: { x: 0.76, y: 0.26, zoom: 1.6 },
          to: { x: 0.76, y: 0.68, zoom: 1.6 },
          duration: 1700,
        },
        { from: { x: 0.5, y: 0.56, zoom: 1.45 }, to: { x: 0.5, y: 0.5, zoom: 1 }, duration: 1900 },
      ],
    },
  },
];

for (const { folder } of folders) {
  if (existsSync(join(WORKSHOP_DIR, folder))) {
    console.error(`${WORKSHOP_DIR}/${folder} existe déjà : rien n'est écrasé.`);
    process.exit(1);
  }
}
for (const { folder, source, edition } of folders) {
  const dir = join(WORKSHOP_DIR, folder);
  mkdirSync(join(dir, 'work'), { recursive: true });
  writeFileSync(join(dir, 'cards.js'), loader(edition.id));
  writeFileSync(join(dir, 'edition.json'), json(edition));
  writeFileSync(join(dir, 'scene.json'), json(scene(source)));
}

const response = await fetch(hero);
if (response.ok) {
  writeFileSync(join(WORKSHOP_DIR, slug, 'source.jpg'), Buffer.from(await response.arrayBuffer()));
  console.log(`Hero Steam enregistré : ${WORKSHOP_DIR}/${slug}/source.jpg`);
} else {
  console.warn(`Pas de hero Steam (${response.status}) : déposer la source à la main.`);
}

console.log(`
Atelier prêt : ${WORKSHOP_DIR}/${slug} et ${WORKSHOP_DIR}/${slug}-mythique.
Ensuite :
  1. Choisir l'artwork officiel de la Mythique (fiche « Cartes à créer » de la modération),
     le déposer en source.* dans ${slug}-mythique et noter son adresse dans scene.json.
  2. Découper les calques (master .ora et fichiers de travail dans work/), exporter full.jpg,
     bg.jpg et les PNG, puis décrire les calques dans scene.json.
  3. Valider le rig sans VFX : node scripts/card-sheet.mjs "<jeu>" Vivante --no-vfx
  4. Ajouter le jeu à src/lib/card-catalogue.json, lancer les tests et le contrôle
     node scripts/check-dev-card-set.mjs "<jeu>" ${slug} ${slug}-mythique
  5. Sauvegarder les sources : bash scripts/nas-card-sources.sh push`);
