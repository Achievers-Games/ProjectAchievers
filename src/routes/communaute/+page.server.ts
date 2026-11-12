import { db } from '#lib/server/db';
import { activityFeed, highlights, leaderboard, type LeaderboardPeriod } from '#lib/server/queries';
import { clanMateIds, friendIds } from '#lib/server/social';
import { publicCache } from '#lib/server/public-cache';
import type { PageServerLoad } from './$types';

const PERIODS: LeaderboardPeriod[] = ['semaine', 'mois', 'tout'];
const TABS = ['amis', 'clan', 'global'] as const;
type Tab = (typeof TABS)[number];

export const load: PageServerLoad = async ({ url, locals, depends }) => {
  depends('app:sync');
  depends('app:communaute');
  const requested = url.searchParams.get('periode') as LeaderboardPeriod;
  const period = PERIODS.includes(requested) ? requested : 'mois';
  const showAdult = locals.user?.showAdult;
  const userId = locals.user?.id;

  const [friends, clan] = userId
    ? await Promise.all([friendIds(userId), clanMateIds(userId)])
    : [[], []];
  // Le proche d'abord : le fil de tout le site n'a d'intérêt que s'il reste rare.
  const fallback: Tab = friends.length ? 'amis' : clan.length ? 'clan' : 'global';
  const asked = url.searchParams.get('onglet') as Tab;
  const tab = userId && TABS.includes(asked) ? asked : userId ? fallback : 'global';
  const circle = tab === 'amis' ? friends : clan;

  const [ranking, feed, moments, handles] = await Promise.all([
    // Le classement de tout le site est le même pour chacun : il passe par le cache public.
    tab === 'global'
      ? publicCache.read(`leaderboard:${period}`, () => leaderboard(period, 20))
      : leaderboard(period, 20, [...circle, userId as string]),
    tab === 'global' ? [] : activityFeed(showAdult, { userIds: circle }),
    tab === 'global' ? highlights(showAdult) : [],
    tab === 'global'
      ? []
      : db.user.findMany({ where: { id: { in: circle } }, select: { handle: true } }),
  ]);
  return { ranking, feed, moments, period, tab, circle: handles.map((user) => user.handle) };
};
