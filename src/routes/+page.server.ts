import { dashboard, listGames } from '$lib/server/queries';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) {
    const [home, accounts] = await Promise.all([
      dashboard(locals.user.id),
      db.linkedAccount.count({ where: { userId: locals.user.id } }),
    ]);
    return { home, accounts, popular: null };
  }
  const { games } = await listGames({ sort: 'succes', page: 1 }, null);
  return { home: null, accounts: 0, popular: games.slice(0, 8) };
};
