import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { sitePop } from '#lib/server/site-achievements';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

const MAX_ZONE = 64;

/** Les succès à fêter : seulement ceux que le joueur a réellement obtenus. */
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) error(401, m.login_required());
  const codes = (url.searchParams.get('codes') ?? '').split(',').slice(0, 100);
  const rows = await db.siteUnlock.findMany({
    where: { userId: locals.user.id, code: { in: codes } },
    select: { code: true },
  });
  return json(rows.map((row) => sitePop(row.code)));
};

function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone.length <= MAX_ZONE;
  } catch {
    return false;
  }
}

/** Le fuseau tient en bien moins que ça ; au-delà, le corps n'a rien à faire ici. */
const MAX_BODY = 256;

/** Lit le corps sans jamais dépasser `limit` : une requête énorme est refusée sans être chargée. */
async function readSmallBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // Client parti avant la fin : la réponse ne l'intéresse plus.
    return '';
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Le fuseau du navigateur, pour les succès liés à l'heure du joueur. */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) error(401, m.login_required());
  const timeZone = await readSmallBody(request, MAX_BODY);
  if (timeZone === null) error(413, m.action_failed());
  if (!isTimeZone(timeZone)) error(400, m.action_failed());
  await db.user.update({ where: { id: locals.user.id }, data: { timeZone } });
  return new Response(null, { status: 204 });
};
