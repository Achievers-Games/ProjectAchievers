import type { Platform } from '#prisma';
import { db } from './db';

/** Mentions commerciales : elles ne changent pas le jeu, seulement son emballage. */
const EDITIONS =
  /\b(remastered|remaster|enhanced|definitive|complete|ultimate|deluxe|goty|game of the year|digital|directors cut|edition|ps[345]|vita)\b/g;

/**
 * Clé commune aux versions d'un même jeu : Steam et PSN n'ont aucun identifiant partagé.
 * Des titres identiques peuvent désigner deux jeux : la modération corrige ces cas.
 */
export function familyKey(name: string): string {
  const title = name
    .replace(/[®™©]/g, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  return title.replace(EDITIONS, ' ').replace(/\s+/g, ' ').trim() || title.trim();
}

/** Renseigne les jeux qui n'ont pas encore de famille. */
export async function fillFamilies() {
  const games = await db.game.findMany({
    where: { familyKey: null },
    select: { id: true, name: true },
  });
  for (const game of games) {
    await db.game.update({ where: { id: game.id }, data: { familyKey: familyKey(game.name) } });
  }
}

/** En dessous, une liste identique peut n'être qu'une coïncidence (« Victoire », « Tutoriel »). */
const MIN_SHARED = 5;

interface ListRow {
  id: string;
  name: string;
  platform: Platform;
  familyKey: string | null;
  familyMatched: boolean;
  signature: string | null;
}

/**
 * Réunit les jeux dont les listes de succès sont identiques, même si leurs noms diffèrent :
 * même jeu sur deux plateformes, ou réédition sur la même. Le trophée Platine, propre au PSN,
 * ne compte pas. Une liste qui cesse d'être identique rend au jeu la famille de son nom.
 * Renvoie le nombre de jeux déplacés.
 */
export async function matchFamilies() {
  const rows = await db.$queryRaw<ListRow[]>`
    WITH names AS (
      SELECT DISTINCT "gameId", lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')) AS n
      FROM "Achievement" WHERE "trophyType" <> 'PLATINUM'
    ), lists AS (
      SELECT "gameId", md5(string_agg(n, '|' ORDER BY n)) AS signature, count(*) AS size
      FROM names WHERE n <> '' GROUP BY "gameId"
    )
    SELECT g.id, g.name, g.platform, g."familyKey", g."familyMatched",
      CASE WHEN l.size >= ${MIN_SHARED} THEN l.signature END AS signature
    FROM "Game" g LEFT JOIN lists l ON l."gameId" = g.id
    WHERE NOT g."familyLocked" AND (g."familyMatched" OR l.size >= ${MIN_SHARED})`;

  const targets = new Map<string, string>();
  for (const group of Map.groupBy(rows, (row) => row.signature).values()) {
    if (group[0]?.signature === null || group.length < 2) continue;
    // Une ancre stable d'un passage à l'autre : la famille de son propre nom, Steam d'abord.
    const rank = (row: ListRow) => (row.familyMatched ? 2 : 0) + (row.platform === 'STEAM' ? 0 : 1);
    const anchor = group.toSorted((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0]!;
    const key = anchor.familyKey ?? familyKey(anchor.name);
    for (const row of group) targets.set(row.id, key);
  }

  let moved = 0;
  for (const row of rows) {
    const target = targets.get(row.id);
    const data = target
      ? { familyKey: target, familyMatched: target !== familyKey(row.name) }
      : { familyKey: familyKey(row.name), familyMatched: false };
    if (data.familyKey === row.familyKey && data.familyMatched === row.familyMatched) continue;
    await db.game.update({ where: { id: row.id }, data });
    moved += 1;
  }
  return moved;
}
