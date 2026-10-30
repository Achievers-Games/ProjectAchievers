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
