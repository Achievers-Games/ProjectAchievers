import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EditionManifest } from './animated-card';
import { EDITIONS } from './boosters';
import { CARD_CATALOGUE } from './card-catalogue';

/**
 * Chaque carte du catalogue est vérifiée avant de partir en production : une carte cassée ne
 * se voit pas (l'image fixe la remplace), donc la CI doit la refuser.
 */
const STATIC = join(process.cwd(), 'static');
const FRAMES = ['forest', 'underworld', 'maple', 'laboratory'];
/** Le poids servi d'un dossier de carte. Cible : 3 Mo pour Relief et Vivante, 6 Mo en Mythique. */
const MAX_FOLDER_BYTES = 6 * 1024 * 1024;
/** Fichiers de fabrication rangés à côté de la carte, jamais chargés par le site. */
const WORK_FILE =
  /(\.ora|\.py|\.mjs|\.html)$|^source\.|-source\.|^prepare-|^work$|^qwen$|^seethrough$/;

const folders = [
  ...new Set(CARD_CATALOGUE.flatMap((game) => EDITIONS.map((kind) => game.editions[kind]))),
];
const folderOf = (assetPath: string) => join(STATIC, assetPath);

function servedBytes(dir: string): number {
  return readdirSync(dir)
    .filter((name) => !WORK_FILE.test(name))
    .reduce((sum, name) => {
      const path = join(dir, name);
      const info = statSync(path);
      return sum + (info.isDirectory() ? servedBytes(path) : info.size);
    }, 0);
}

describe('le catalogue de cartes', () => {
  it('donne ses trois raretés à chaque jeu, une seule fois', () => {
    const appIds = CARD_CATALOGUE.map((game) => game.steamAppId);
    expect(new Set(appIds).size).toBe(appIds.length);
    for (const game of CARD_CATALOGUE) {
      expect(game.steamAppId, game.name).toMatch(/^\d+$/);
      for (const kind of EDITIONS)
        expect(game.editions[kind], `${game.name} ${kind}`).toMatch(/\/$/);
    }
  });

  it.each(folders)('%s : manifeste, script, image fixe et poids', (assetPath) => {
    const dir = folderOf(assetPath);
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

  it('ne partage aucun identifiant de carte entre deux dossiers', () => {
    const ids = folders.map(
      (assetPath) =>
        (
          JSON.parse(readFileSync(join(folderOf(assetPath), 'edition.json'), 'utf8')) as {
            id: string;
          }
        ).id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
