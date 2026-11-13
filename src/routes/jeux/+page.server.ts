import { unlinkedPlatforms } from '#lib/server/accounts';
import { gamesFromUrl } from '#lib/server/game-list';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals, depends, setHeaders }) => {
  depends('app:sync');
  const timings: string[] = [];
  const started = performance.now();
  const [list, unlinked] = await Promise.all([
    gamesFromUrl(url, locals.user, (metric, duration) => {
      timings.push(`${metric};dur=${Math.round(duration)}`);
    }),
    locals.user ? unlinkedPlatforms(locals.user.id) : [],
  ]);
  timings.push(`games_load;dur=${Math.round(performance.now() - started)}`);
  setHeaders({ 'Server-Timing': timings.join(', ') });
  return { ...list, unlinked };
};
