import { SEASON, seasonState } from '$lib/season';
import { listGames, seasonStats } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

const WAITING_GAMES = 4;

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id;
  const [stats, library] = await Promise.all([
    seasonStats(SEASON),
    userId
      ? listGames({ sort: 'progression', page: 1, ownerId: userId, unfinished: true }, userId)
      : null,
  ]);

  return {
    state: seasonState(SEASON),
    startsAt: SEASON.startsAt,
    endsAt: SEASON.endsAt,
    goal: SEASON.goal,
    tiers: SEASON.tiers,
    dailyCap: SEASON.dailyCap,
    completionBonus: SEASON.completionBonus,
    unlocked: stats.unlocked,
    ranking: stats.ranking.filter((row) => row.isPublic).slice(0, 10),
    points: stats.ranking.find((row) => row.id === userId)?.points ?? 0,
    waiting: library?.games.slice(0, WAITING_GAMES) ?? [],
  };
};
