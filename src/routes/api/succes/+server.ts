import { error, json } from '@sveltejs/kit';
import { readSmallBody } from '#lib/server/body';
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
  // Un clic sur l'annonce mène à la carte du succès, sur la page des succès du joueur.
  return json(
    rows.map((row) => ({
      ...sitePop(row.code),
      href: `/u/${locals.user!.handle}/succes#succes-${row.code}`,
    })),
  );
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

/** Le fuseau du navigateur, pour les succès liés à l'heure du joueur. */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) error(401, m.login_required());
  const timeZone = await readSmallBody(request, MAX_BODY);
  if (timeZone === null) error(413, m.action_failed());
  if (!isTimeZone(timeZone)) error(400, m.action_failed());
  await db.user.update({ where: { id: locals.user.id }, data: { timeZone } });
  return new Response(null, { status: 204 });
};
