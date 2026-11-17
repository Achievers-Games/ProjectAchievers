import { deflateSync } from 'node:zlib';
import { svgToPixels } from './player-card-png';

/**
 * La carte de joueur en PDF, pour l'imprimer ou la garder hors ligne.
 *
 * Une page à la taille exacte de la carte, qui ne contient que l'image rendue par resvg : pas
 * besoin d'une bibliothèque PDF pour un seul dessin. L'image est rendue au quadruple pour rester
 * nette à l'impression, et sa transparence (les coins arrondis) passe par un masque à part.
 */

/** 72 points par pouce : la carte de 600 px fait 600 pt, soit environ 21 cm de large. */
const PRINT_SCALE = 4;

const BOM = String.fromCharCode(0xfeff);

/** resvg rend des couleurs prémultipliées ; le PDF attend la couleur pure et l'alpha à côté. */
export function splitAlpha(rgba: Uint8Array) {
  const pixels = rgba.length / 4;
  const rgb = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  let opaque = true;
  for (let index = 0; index < pixels; index++) {
    const a = rgba[index * 4 + 3]!;
    alpha[index] = a;
    if (a !== 255) opaque = false;
    for (let channel = 0; channel < 3; channel++) {
      const value = rgba[index * 4 + channel]!;
      rgb[index * 3 + channel] =
        a === 0 ? 0 : a === 255 ? value : Math.min(255, Math.round((value * 255) / a));
    }
  }
  return { rgb, alpha: opaque ? null : alpha };
}

/** Assemble un PDF d'une page : chaque objet est numéroté, puis indexé à la fin par sa position. */
export function imagePdf(
  image: { width: number; height: number; rgb: Uint8Array; alpha: Uint8Array | null },
  page: { width: number; height: number },
  title: string,
): Uint8Array {
  const color = deflateSync(image.rgb);
  const mask = image.alpha ? deflateSync(image.alpha) : null;
  const imageDict = (space: string, length: number, extra = '') =>
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
    `/ColorSpace /${space} /BitsPerComponent 8 /Filter /FlateDecode /Length ${length}${extra} >>`;
  const content = `q ${page.width} 0 0 ${page.height} 0 0 cm /Card Do Q`;

  // Le titre passe en UTF-16 avec sa marque d’ordre : noms accentués et cyrillique restent lisibles.
  const utf16 = Buffer.from(`${BOM}${title}`, 'utf16le').swap16().toString('hex');

  const objects: (string | [string, Uint8Array])[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
      '/Resources << /XObject << /Card 5 0 R >> >> /Contents 4 0 R >>',
    [`<< /Length ${content.length} >>`, Buffer.from(content, 'latin1')],
    [imageDict('DeviceRGB', color.length, mask ? ' /SMask 7 0 R' : ''), color],
    `<< /Title <${utf16}> /Producer (Achievers) >>`,
  ];
  if (mask) objects.push([imageDict('DeviceGray', mask.length), mask]);

  const chunks: Uint8Array[] = [];
  let size = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? Buffer.from(part, 'latin1') : part;
    chunks.push(bytes);
    size += bytes.length;
  };

  // Le commentaire binaire signale aux outils de transfert que le fichier n'est pas du texte.
  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets = objects.map((object, index) => {
    const at = size;
    write(`${index + 1} 0 obj\n`);
    if (typeof object === 'string') write(object);
    else {
      write(`${object[0]}\nstream\n`);
      write(object[1]);
      write('\nendstream');
    }
    write('\nendobj\n');
    return at;
  });

  const xref = size;
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) write(`${String(offset).padStart(10, '0')} 00000 n \n`);
  write(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n` +
      `startxref\n${xref}\n%%EOF\n`,
  );

  return Buffer.concat(chunks);
}

/** La carte entière, du SVG au PDF prêt à télécharger. */
export async function svgToPdf(
  svg: string,
  page: { width: number; height: number },
  title: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const { width, height, rgba } = await svgToPixels(svg, page.width, PRINT_SCALE);
  const pdf = imagePdf({ width, height, ...splitAlpha(rgba) }, page, title);
  return new Uint8Array(pdf);
}
