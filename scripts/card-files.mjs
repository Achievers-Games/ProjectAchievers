// Ce qu'une carte publie : son dossier d'atelier sans les fichiers de fabrication. Partagé par le
// script de publication et par le test du catalogue, pour qu'ils mesurent la même chose.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** L'atelier des cartes : un dossier par édition, servi en développement sous `/_proto/`. */
export const WORKSHOP_DIR = 'static/_proto';

/** Fichiers de fabrication rangés à côté de la carte, jamais chargés par le site. */
export const WORK_FILE =
  /(\.ora|\.py|\.mjs|\.html)$|^source\.|-source\.|^prepare-|^work$|^qwen$|^seethrough$/;

/**
 * Les fichiers servis d'un dossier, en chemins relatifs avec des barres obliques.
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function servedFiles(dir, prefix = '') {
  return readdirSync(dir)
    .filter((name) => !WORK_FILE.test(name))
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? servedFiles(path, `${prefix}${name}/`)
        : [`${prefix}${name}`];
    });
}
