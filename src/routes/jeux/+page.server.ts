import { unlinkedPlatforms } from '#lib/server/accounts';
import { gamesFromUrl } from '#lib/server/game-list';
import { serverTiming } from '#lib/server/server-timing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals, depends, setHeaders }) => {
  depends('app:sync');
  const timing = serverTiming();
  const [list, unlinked] = await Promise.all([
    gamesFromUrl(url, locals.user, timing.record),
    locals.user ? unlinkedPlatforms(locals.user.id) : [],
  ]);
  timing.mark('games_load');
  setHeaders(timing.headers());
  return { ...list, unlinked };
};
