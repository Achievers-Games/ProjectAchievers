import { bannerGames, cardFeed, collectors, dashboard, listGames } from '$lib/server/queries';
import { db } from '$lib/server/db';
import { randomTagline } from '$lib/taglines';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) {
    const [home, accounts, cards, podium, banners] = await Promise.all([
      dashboard(locals.user.id, locals.user.showAdult),
      db.linkedAccount.count({ where: { userId: locals.user.id } }),
      cardFeed(locals.user.showAdult),
      collectors(3),
      bannerGames(locals.user.id),
    ]);
    const { games, tiers } = home.stats;
    const tagline = randomTagline({
      games,
      finished: tiers.or + tiers.platine + tiers.prismatique + tiers.legendaire,
      closest: banners[0]?.completion ?? null,
    });
    return { home, accounts, cards, podium, banners, popular: null, tagline };
  }
  const [{ games }, cards, podium, banners] = await Promise.all([
    listGames({ sort: 'succes', page: 1 }, null),
    cardFeed(),
    collectors(3),
    bannerGames(),
  ]);
  return {
    home: null,
    accounts: 0,
    cards,
    podium,
    banners,
    popular: games.slice(0, 8),
    tagline: randomTagline(),
  };
};
