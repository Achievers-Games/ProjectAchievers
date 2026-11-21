import { json } from '@sveltejs/kit';
import { requireCards } from '#lib/server/cards-launch';
import { collectionCards, collectionFilters } from '../collection.server';
import type { RequestHandler } from './$types';

/** La page suivante de la collection, pour « Afficher plus » : seul le joueur voit la sienne. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireCards(locals, '/boosters/collection');
  return json(await collectionCards(user.id, collectionFilters(url)));
};
