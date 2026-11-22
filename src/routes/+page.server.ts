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
import { friendUnlocks, loadUnlockDiscussion, unlockThreadFor } from '#lib/server/activity';
import { commentActions } from '#lib/server/comments';
import { homeGuides } from '#lib/server/guides';
import { suggestions } from '#lib/server/recommendations';
import { randomTagline } from '#lib/taglines';
import type { Actions, PageServerLoad } from './$types';

const selected = (viewer: App.Locals['user'], url: URL) => {
  const handle = url.searchParams.get('ami');
  const id = url.searchParams.get('deblocage');
  return handle && id ? unlockThreadFor(viewer, handle, id) : null;
};

export const load: PageServerLoad = async ({ locals, depends, setHeaders, url }) => {
  depends('app:sync');
  const podiumTask = homePodium();
  // Un jeu au hasard derrière l'accueil, tiré à chaque visite parmi les plus joués.
  const backdropTask = homeBackdrop();
  if (locals.user) {
    setHeaders({ 'cache-control': 'private, no-store' });
    const viewer = locals.user;
    const [
      podium,
      home,
      accounts,
      cards,
      banners,
      barelyPlayed,
      unlinked,
      friends,
      guides,
      unlocks,
      thread,
      suggested,
    ] = await Promise.all([
      podiumTask,
      dashboard(locals.user.id, locals.user.showAdult),
      db.linkedAccount.count({ where: { userId: locals.user.id } }),
      cardFeed(viewer.showAdult, 12, viewer.id),
      podiumTask.then((podium) => homeBanners(podium[0], locals.user!.id)),
      barelyPlayedGame(locals.user.id, locals.user.showAdult),
      unlinkedPlatforms(locals.user.id),
      friendsPlaying(locals.user.id, locals.user.showAdult),
      homeGuides(locals.user.showAdult),
      friendUnlocks(viewer),
      Promise.resolve(selected(viewer, url)).then((row) =>
        row ? loadUnlockDiscussion(viewer, row, url) : null,
      ),
      suggestions(viewer.id, viewer.showAdult),
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
      unlocks,
      thread,
      suggested,
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
    unlocks: [],
    thread: null,
    suggested: null,
    guides,
    cards,
    podium,
    banners,
    popular: games,
    tagline: randomTagline().text,
    backdrop: await backdropTask,
  };
};

export const actions: Actions = commentActions(async ({ locals, url }) => {
  const row = await selected(locals.user, url);
  return row ? { unlockOwnerId: row.userId, unlockAchievementId: row.achievement.id } : null;
});
