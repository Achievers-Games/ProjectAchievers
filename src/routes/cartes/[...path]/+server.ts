import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { env } from '#lib/server/env';
import type { RequestHandler } from './$types';

/**
 * Les cartes publiées, lues dans `CARDS_DIR` (un dossier du NAS monté dans le conteneur) et non
 * dans l'image du site : ajouter une carte ne demande ni build ni déploiement. Chaque adresse
 * porte une version (`/cartes/<dossier>/<version>/…`) et n'est jamais réécrite : Cloudflare et le
 * navigateur la gardent un an. Seuls les types de fichiers d'une carte sont servis.
 */
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

async function serve(path: string, head: boolean) {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type || path.split('/').some((part) => part === '..' || part.startsWith('.'))) {
    error(404, 'Introuvable');
  }
  const root = resolve(env().CARDS_DIR);
  const file = resolve(root, path);
  if (!file.startsWith(root + sep)) error(404, 'Introuvable');
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) error(404, 'Introuvable');
  const headers = {
    'Content-Type': type,
    'Content-Length': String(info.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Last-Modified': info.mtime.toUTCString(),
    // Les textures WebGL et les modules chargés par `import()` restent lisibles hors du site.
    'Access-Control-Allow-Origin': '*',
  };
  if (head) return new Response(null, { headers });
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(body, { headers });
}

export const GET: RequestHandler = ({ params }) => serve(params.path, false);
export const HEAD: RequestHandler = ({ params }) => serve(params.path, true);
