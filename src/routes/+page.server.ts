import {
  barelyPlayedGame,
  cardFeed,
  collectors,
  dashboard,
  homeBanners,
  listGames,
  toBanner,
} from '$lib/server/queries';
import { db } from '$lib/server/db';
import { randomTagline } from '$lib/taglines';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) {
    const [home, accounts, cards, podium, banners, barelyPlayed] = await Promise.all([
      dashboard(locals.user.id, locals.user.showAdult),
      db.linkedAccount.count({ where: { userId: locals.user.id } }),
      cardFeed(locals.user.showAdult),
      collectors(3),
      homeBanners(locals.user.id),
      barelyPlayedGame(locals.user.id, locals.user.showAdult),
    ]);
    const { games, tiers } = home.stats;
    const { text: tagline, barelyPlayed: aboutBarelyPlayed } = randomTagline({
      games,
      finished: tiers.or + tiers.platine + tiers.prismatique + tiers.legendaire,
      closest: banners.season?.completion ?? null,
      closestName: banners.season?.name ?? null,
      barelyPlayed,
    });
    if (aboutBarelyPlayed && barelyPlayed) banners.season = toBanner(barelyPlayed);
    return { home, accounts, cards, podium, banners, popular: null, tagline };
  }
  const [{ games }, cards, podium, banners] = await Promise.all([
    listGames({ sort: 'succes', page: 1 }, null),
    cardFeed(),
    collectors(3),
    homeBanners(),
  ]);
  return {
    home: null,
    accounts: 0,
    cards,
    podium,
    banners,
    popular: games.slice(0, 8),
    tagline: randomTagline().text,
  };
};
