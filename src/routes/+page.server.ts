import {
  barelyPlayedGame,
  cardFeed,
  collectors,
  dashboard,
  homeBanners,
  listGames,
  toBanner,
} from '$lib/server/queries';
import { unlinkedPlatforms } from '$lib/server/accounts';
import { db } from '$lib/server/db';
import { randomTagline } from '$lib/taglines';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) {
    const podium = await collectors(3);
    const [home, accounts, cards, banners, barelyPlayed, unlinked] = await Promise.all([
      dashboard(locals.user.id, locals.user.showAdult),
      db.linkedAccount.count({ where: { userId: locals.user.id } }),
      cardFeed(locals.user.showAdult),
      homeBanners(podium[0], locals.user.id),
      barelyPlayedGame(locals.user.id, locals.user.showAdult),
      unlinkedPlatforms(locals.user.id),
    ]);
    const { games, tiers } = home.stats;
    const { text: tagline, barelyPlayed: aboutBarelyPlayed } = randomTagline({
      games,
      finished: tiers.reduce((sum, count) => sum + count, 0),
      closest: banners.season?.completion ?? null,
      closestName: banners.season?.name ?? null,
      barelyPlayed,
    });
    if (aboutBarelyPlayed && barelyPlayed) banners.season = toBanner(barelyPlayed);
    return { home, accounts, unlinked, cards, podium, banners, popular: null, tagline };
  }
  const podium = await collectors(3);
  const [{ games }, cards, banners] = await Promise.all([
    listGames({ sort: 'succes', page: 1 }, null),
    cardFeed(),
    homeBanners(podium[0]),
  ]);
  return {
    home: null,
    accounts: 0,
    unlinked: [],
    cards,
    podium,
    banners,
    popular: games.slice(0, 8),
    tagline: randomTagline().text,
  };
};
