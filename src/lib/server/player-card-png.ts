import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

/**
 * La carte de joueur en PNG, pour Discord et les forums qui n'affichent pas le SVG.
 *
 * Le rendu passe par resvg en WebAssembly : l'image du NAS est construite sur une autre
 * architecture que celle qui l'exécute, et une bibliothèque native n'y survivrait pas.
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

let ready: Promise<Uint8Array[]> | null = null;

/** Le WebAssembly et les polices, chargés une seule fois pour toute la vie du serveur. */
function prepare() {
  ready ??= (async () => {
    await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    // Le latin étendu et le cyrillique couvrent les noms accentués et la version russe du site.
    // Le chinois et le japonais n'ont pas de glyphes dans Inter : leurs libellés resteraient vides.
    return SUBSETS.flatMap((subset) =>
      WEIGHTS.map((weight) =>
        woffToSfnt(
          readFileSync(
            require.resolve(`@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`),
          ),
        ),
      ),
    );
  })().catch((cause) => {
    // Un échec ne doit pas rester en cache : la prochaine demande retentera.
    ready = null;
    throw cause;
  });
  return ready;
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
  return render(svg, width * scale, (image) => new Uint8Array(image.asPng()));
}

/** Les pixels bruts, en RGBA prémultiplié, pour qui assemble lui-même son fichier (le PDF). */
export async function svgToPixels(svg: string, width: number, scale = 2) {
  return render(svg, width * scale, (image) => ({
    width: image.width,
    height: image.height,
    rgba: new Uint8Array(image.pixels),
  }));
}

type Rendered = ReturnType<InstanceType<typeof Resvg>['render']>;

async function render<T>(svg: string, width: number, read: (image: Rendered) => T): Promise<T> {
  const fontBuffers = await prepare();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontBuffers, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' },
  });
  try {
    const image = resvg.render();
    try {
      // Une copie détachée de la mémoire du WebAssembly, libérée juste après.
      return read(image);
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}
