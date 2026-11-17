import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';

/**
 * La carte de joueur en PNG, pour Discord et les forums qui n'affichent pas le SVG.
 *
 * Le rendu passe par resvg en WebAssembly : l'image du NAS est construite sur une autre
 * architecture que celle qui l'exécute, et une bibliothèque native n'y survivrait pas.
 *
 * Il tourne dans un thread à part : synchrone, il figeait tout le serveur pendant qu'il
 * dessinait (1,7 s par carte sur le NAS, 7,6 s au premier rendu), et chaque partage d'un
 * profil sur Discord bloquait alors toutes les pages du site.
 */

const require = createRequire(import.meta.url);

/** Les graisses de la carte : texte courant, libellés, noms et chiffres. */
const WEIGHTS = [400, 700, 800];
const SUBSETS = ['latin', 'latin-ext', 'cyrillic'];

/**
 * Un WOFF n'est qu'un TTF dont chaque table est compressée à part : on le remet à plat.
 * resvg ne lit que les polices TTF ou OTF, et `@fontsource` ne livre que du WOFF.
 */
function woffToSfnt(woff: Uint8Array): Uint8Array {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (view.getUint32(0) !== 0x774f4646) throw new Error('Pas un fichier WOFF');
  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);

  const tables = Array.from({ length: numTables }, (_, index) => {
    const entry = 44 + index * 20;
    const offset = view.getUint32(entry + 4);
    const compLength = view.getUint32(entry + 8);
    const origLength = view.getUint32(entry + 12);
    const raw = woff.subarray(offset, offset + compLength);
    return {
      tag: view.getUint32(entry),
      checksum: view.getUint32(entry + 16),
      data: compLength < origLength ? new Uint8Array(inflateSync(raw)) : raw,
    };
  });

  const pad = (length: number) => (length + 3) & ~3;
  const headerSize = 12 + numTables * 16;
  const total = tables.reduce((size, table) => size + pad(table.data.length), headerSize);
  const out = new Uint8Array(total);
  const write = new DataView(out.buffer);

  const power = 2 ** Math.floor(Math.log2(numTables));
  write.setUint32(0, flavor);
  write.setUint16(4, numTables);
  write.setUint16(6, power * 16);
  write.setUint16(8, Math.log2(power));
  write.setUint16(10, numTables * 16 - power * 16);

  let offset = headerSize;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    write.setUint32(record, table.tag);
    write.setUint32(record + 4, table.checksum);
    write.setUint32(record + 8, offset);
    write.setUint32(record + 12, table.data.length);
    out.set(table.data, offset);
    offset += pad(table.data.length);
  });
  return out;
}

/**
 * Le thread de rendu, en CommonJS évalué : il ne dépend d'aucun fichier produit par Vite.
 * Les chemins de resvg et les polices lui arrivent tout prêts du thread principal.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { readFileSync } = require('node:fs');
const { initWasm, Resvg } = require(workerData.resvg);
const ready = initWasm(readFileSync(workerData.wasm));
parentPort.on('message', async ({ id, svg, width, pixels }) => {
  try {
    await ready;
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: { fontBuffers: workerData.fonts, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' },
    });
    try {
      const image = resvg.render();
      try {
        // Une copie détachée de la mémoire du WebAssembly, transférée sans recopie.
        const data = new Uint8Array(pixels ? image.pixels : image.asPng());
        parentPort.postMessage(
          { id, data, width: image.width, height: image.height },
          [data.buffer],
        );
      } finally {
        image.free();
      }
    } finally {
      resvg.free();
    }
  } catch (error) {
    parentPort.postMessage({ id, error: String((error && error.stack) || error) });
  }
});
`;

interface Rendered {
  data: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

type Pending = { resolve: (image: Rendered) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

/** Un thread perdu fait échouer ses rendus en cours ; la demande suivante en relance un. */
function fail(error: Error) {
  worker = null;
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}

function renderer() {
  if (worker) return worker;
  const started = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      resvg: require.resolve('@resvg/resvg-wasm'),
      wasm: require.resolve('@resvg/resvg-wasm/index_bg.wasm'),
      fonts: fonts(),
    },
  });
  started.on('message', ({ id, error, ...image }: { id: number; error?: string } & Rendered) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(image);
    // Au repos, le thread ne retient pas le processus (tests, arrêt du serveur).
    if (!pending.size) started.unref();
  });
  started.on('error', (error: unknown) => {
    if (worker === started) fail(error instanceof Error ? error : new Error(String(error)));
  });
  started.on('exit', (code) => {
    if (worker === started) fail(new Error(`Rendu de carte arrêté (code ${code})`));
  });
  started.unref();
  worker = started;
  return started;
}

let fontCache: Uint8Array[] | null = null;

/** Les polices, converties une seule fois pour toute la vie du serveur. */
function fonts() {
  // Le latin étendu et le cyrillique couvrent les noms accentués et la version russe du site.
  // Le chinois et le japonais n'ont pas de glyphes dans Inter : leurs libellés resteraient vides.
  fontCache ??= SUBSETS.flatMap((subset) =>
    WEIGHTS.map((weight) =>
      woffToSfnt(
        readFileSync(
          require.resolve(`@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`),
        ),
      ),
    ),
  );
  return fontCache;
}

function render(svg: string, width: number, pixels: boolean): Promise<Rendered> {
  const thread = renderer();
  const id = nextId++;
  return new Promise<Rendered>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    thread.ref();
    thread.postMessage({ id, svg, width, pixels });
  });
}

/**
 * Le SVG rendu en PNG, par défaut au double de sa taille pour rester net sur écran dense.
 * L'image de partage reste à l'échelle 1 : les réseaux la veulent en 1200 × 630.
 */
export async function svgToPng(
  svg: string,
  width: number,
  scale = 2,
): Promise<Uint8Array<ArrayBuffer>> {
  return (await render(svg, width * scale, false)).data;
}

/** Les pixels bruts, en RGBA prémultiplié, pour qui assemble lui-même son fichier (le PDF). */
export async function svgToPixels(svg: string, width: number, scale = 2) {
  const { width: w, height, data } = await render(svg, width * scale, true);
  return { width: w, height, rgba: data };
}
