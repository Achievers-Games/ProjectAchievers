import { cardFeed, collectors, dashboard, listGames } from '$lib/server/queries';
import { db } from '$lib/server/db';
import { randomTagline } from '$lib/taglines';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) {
    const [home, accounts, cards, podium] = await Promise.all([
      dashboard(locals.user.id, locals.user.showAdult),
      db.linkedAccount.count({ where: { userId: locals.user.id } }),
      cardFeed(locals.user.showAdult),
      collectors(3),
    ]);
    return { home, accounts, cards, podium, popular: null, tagline: randomTagline() };
  }
  const [{ games }, cards, podium] = await Promise.all([
    listGames({ sort: 'succes', page: 1 }, null),
    cardFeed(),
    collectors(3),
  ]);
  return {
    home: null,
    accounts: 0,
    cards,
    podium,
    popular: games.slice(0, 8),
    tagline: randomTagline(),
  };
};
