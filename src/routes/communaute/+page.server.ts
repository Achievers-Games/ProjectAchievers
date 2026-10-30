import { activityFeed, leaderboard, type LeaderboardPeriod } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

const PERIODS: LeaderboardPeriod[] = ['semaine', 'mois', 'tout'];

export const load: PageServerLoad = async ({ url }) => {
  const requested = url.searchParams.get('periode') as LeaderboardPeriod;
  const period = PERIODS.includes(requested) ? requested : 'mois';
  const [ranking, feed] = await Promise.all([leaderboard(period), activityFeed()]);
  return { ranking, feed, period };
};
