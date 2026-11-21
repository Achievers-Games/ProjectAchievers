import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EditionManifest } from './animated-card';
import { EDITIONS } from './boosters';
import { servedFiles, WORKSHOP_DIR } from '../../scripts/card-files.mjs';
import { CARD_CATALOGUE } from './card-catalogue';
import { EFFECT_TYPES, INTRO_TYPES } from '../../static/_proto/shared/card-engine.js';

interface DataScene {
  engine: number;
  view: number[];
  background: { file: string };
  curves?: Record<string, number[]>;
  sprites?: Record<string, { file: string }>;
  layers: {
    id: string;
    file?: string;
    parent?: string;
    clip?: { frame: string };
    motion?: { curve?: string }[];
  }[];
  effects?: { type: string; before?: string; attach?: string; frame?: string; sprite?: string }[];
  intro?: { type: string; revealAt: number };
}

/**
 * Chaque carte du catalogue est vérifiée avant de partir en production : une carte cassée ne
 * se voit pas (l'image fixe la remplace), donc la CI doit la refuser.
 */
const FRAMES = ['forest', 'underworld', 'maple', 'laboratory'];
/** Le poids publié d'un dossier de carte. Cible : 3 Mo pour Relief et Vivante, 6 Mo en Mythique. */
const MAX_FOLDER_BYTES = 6 * 1024 * 1024;

const folders = [
  ...new Set(CARD_CATALOGUE.flatMap((game) => EDITIONS.map((kind) => game.editions[kind]))),
];
const folderOf = (folder: string) => join(process.cwd(), WORKSHOP_DIR, folder);
/** Une scène pour le moteur commun (`shared/card-engine.js`), et non un rendu fait à la main. */
const isDataScene = (folder: string) => {
  const path = join(folderOf(folder), 'scene.json');
  return (
    existsSync(path) && (JSON.parse(readFileSync(path, 'utf8')) as { engine?: number }).engine === 2
  );
};
const servedBytes = (dir: string) =>
  servedFiles(dir).reduce((sum, file) => sum + statSync(join(dir, file)).size, 0);

describe('le catalogue de cartes', () => {
  it('donne ses trois raretés à chaque jeu, une seule fois', () => {
    const appIds = CARD_CATALOGUE.map((game) => game.steamAppId);
    expect(new Set(appIds).size).toBe(appIds.length);
    for (const game of CARD_CATALOGUE) {
      expect(game.steamAppId, game.name).toMatch(/^\d+$/);
      expect(Number.isInteger(game.version) && game.version > 0, game.name).toBe(true);
      for (const kind of EDITIONS)
        expect(game.editions[kind], `${game.name} ${kind}`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it.each(folders)('%s : manifeste, script, image fixe et poids', (folder) => {
    const dir = folderOf(folder);
    expect(existsSync(dir), dir).toBe(true);
    expect(existsSync(join(dir, 'full.jpg')), 'full.jpg').toBe(true);
    const manifest = JSON.parse(readFileSync(join(dir, 'edition.json'), 'utf8')) as EditionManifest;
    expect(manifest.id).toMatch(/^[a-z0-9-]+$/);
    expect(Array.isArray(manifest.shots)).toBe(true);
    if (manifest.sound) expect(existsSync(join(dir, manifest.sound)), manifest.sound).toBe(true);
    if (manifest.frame) expect(FRAMES).toContain(manifest.frame);
    if (manifest.title) expect(['fantasy', 'plaque']).toContain(manifest.title);
    if (manifest.intro) {
      // Le booster affiche le titre deux secondes après la date annoncée, au plus tard.
      expect(manifest.intro.revealAt).toBeGreaterThanOrEqual(1000);
      expect(manifest.intro.revealAt).toBeLessThanOrEqual(6000);
    }
    // Le script enregistre la carte sous l'identifiant du manifeste.
    const script = readFileSync(join(dir, 'cards.js'), 'utf8');
    const registered = [`'${manifest.id}'`, `"${manifest.id}"`, `.${manifest.id} =`];
    expect(
      registered.some((form) => script.includes(form)),
      'identifiant dans cards.js',
    ).toBe(true);
    expect(servedBytes(dir)).toBeLessThanOrEqual(MAX_FOLDER_BYTES);
  });

  // Une carte décrite par des données (moteur commun) : chaque référence doit exister.
  it.each(folders.filter((folder) => isDataScene(folder)))(
    '%s : scène du moteur commun',
    (folder) => {
      const dir = folderOf(folder);
      const scene = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as DataScene;
      expect(scene.view).toHaveLength(4);
      expect(existsSync(join(dir, scene.background.file)), scene.background.file).toBe(true);
      const ids = new Set(scene.layers.map((layer) => layer.id));
      expect(ids.size, 'identifiants de calques uniques').toBe(scene.layers.length);
      const curves = new Set(Object.keys(scene.curves ?? {}));
      for (const layer of scene.layers) {
        if (layer.file) expect(existsSync(join(dir, layer.file)), layer.file).toBe(true);
        if (layer.parent) expect(ids, `parent de ${layer.id}`).toContain(layer.parent);
        if (layer.clip) expect(ids, `découpage de ${layer.id}`).toContain(layer.clip.frame);
        for (const term of layer.motion ?? []) {
          if (term.curve) expect(curves, `courbe de ${layer.id}`).toContain(term.curve);
        }
      }
      for (const sprite of Object.values(scene.sprites ?? {})) {
        expect(existsSync(join(dir, sprite.file)), sprite.file).toBe(true);
      }
      for (const fx of scene.effects ?? []) {
        expect(EFFECT_TYPES).toContain(fx.type);
        for (const id of [fx.before, fx.attach, fx.frame])
          if (id) expect(ids, `${fx.type} → ${id}`).toContain(id);
        if (fx.sprite) expect(Object.keys(scene.sprites ?? {})).toContain(fx.sprite);
      }
      if (scene.intro) {
        expect(INTRO_TYPES).toContain(scene.intro.type);
        expect(scene.intro.revealAt).toBeGreaterThanOrEqual(1000);
        expect(scene.intro.revealAt).toBeLessThanOrEqual(6000);
        // Le manifeste annonce le même dévoilement au booster.
        const manifest = JSON.parse(
          readFileSync(join(dir, 'edition.json'), 'utf8'),
        ) as EditionManifest;
        expect(manifest.intro?.revealAt).toBe(scene.intro.revealAt);
      }
    },
  );

  it('ne partage aucun identifiant de carte entre deux dossiers', () => {
    const ids = folders.map(
      (folder) =>
        (
          JSON.parse(readFileSync(join(folderOf(folder), 'edition.json'), 'utf8')) as {
            id: string;
          }
        ).id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
