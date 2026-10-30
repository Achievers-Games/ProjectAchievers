import { json } from '@sveltejs/kit';
import { gamesFromUrl } from '$lib/server/game-list';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const { games } = await gamesFromUrl(url, locals.user);
  return json(games);
};
