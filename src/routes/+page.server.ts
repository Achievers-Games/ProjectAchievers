import { cardFeed, dashboard, listGames } from '$lib/server/queries';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) {
    const [home, accounts, cards] = await Promise.all([
      dashboard(locals.user.id),
      db.linkedAccount.count({ where: { userId: locals.user.id } }),
      cardFeed(),
    ]);
    return { home, accounts, cards, popular: null };
  }
  const [{ games }, cards] = await Promise.all([
    listGames({ sort: 'succes', page: 1 }, null),
    cardFeed(),
  ]);
  return { home: null, accounts: 0, cards, popular: games.slice(0, 8) };
};
