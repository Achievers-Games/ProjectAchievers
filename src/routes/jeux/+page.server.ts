import { unlinkedPlatforms } from '$lib/server/accounts';
import { gamesFromUrl } from '$lib/server/game-list';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
  const [list, unlinked] = await Promise.all([
    gamesFromUrl(url, locals.user),
    locals.user ? unlinkedPlatforms(locals.user.id) : [],
  ]);
  return { ...list, unlinked };
};
