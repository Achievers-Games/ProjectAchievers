import { json } from '@sveltejs/kit';
import { requireLogin } from '#lib/server/auth';
import { collectionCards, collectionFilters } from '../collection.server';
import type { RequestHandler } from './$types';

/** La page suivante de la collection, pour « Afficher plus » : seul le joueur voit la sienne. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireLogin(locals, '/boosters/collection');
  return json(await collectionCards(user.id, collectionFilters(url)));
};
