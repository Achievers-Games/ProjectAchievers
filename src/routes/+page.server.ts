import {
  barelyPlayedGame,
  cardFeed,
  homePodium,
  homePopularGames,
  dashboard,
  friendsPlaying,
  homeBackdrop,
  homeBanners,
  toBanner,
} from '#lib/server/queries';
import { unlinkedPlatforms } from '#lib/server/accounts';
import { db } from '#lib/server/db';
import { homeGuides } from '#lib/server/guides';
import { randomTagline } from '#lib/taglines';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:sync');
  const podiumTask = homePodium();
  // Un jeu au hasard derrière l'accueil, tiré à chaque visite parmi les plus joués.
  const backdropTask = homeBackdrop();
  if (locals.user) {
    const [podium, home, accounts, cards, banners, barelyPlayed, unlinked, friends, guides] =
      await Promise.all([
        podiumTask,
        dashboard(locals.user.id, locals.user.showAdult),
        db.linkedAccount.count({ where: { userId: locals.user.id } }),
        cardFeed(locals.user.showAdult),
        podiumTask.then((podium) => homeBanners(podium[0], locals.user!.id)),
        barelyPlayedGame(locals.user.id, locals.user.showAdult),
        unlinkedPlatforms(locals.user.id),
        friendsPlaying(locals.user.id, locals.user.showAdult),
        homeGuides(locals.user.showAdult),
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
    return {
      home,
      accounts,
      unlinked,
      cards,
      podium,
      banners,
      friends,
      guides,
      popular: null,
      tagline,
      backdrop: await backdropTask,
    };
  }
  const [podium, games, cards, banners, guides] = await Promise.all([
    podiumTask,
    homePopularGames(),
    cardFeed(),
    podiumTask.then((podium) => homeBanners(podium[0])),
    homeGuides(),
  ]);
  return {
    home: null,
    accounts: 0,
    unlinked: [],
    friends: [],
    guides,
    cards,
    podium,
    banners,
    popular: games,
    tagline: randomTagline().text,
    backdrop: await backdropTask,
  };
};
