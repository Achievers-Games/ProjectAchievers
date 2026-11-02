import { SEASON, seasonState } from '$lib/season';
import { listGames, seasonStats } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

const WAITING_GAMES = 4;

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id;
  const [stats, library] = await Promise.all([
    seasonStats(SEASON),
    userId
      ? listGames(
          {
            sort: 'progression',
            page: 1,
            ownerId: userId,
            status: 'saison',
            showAdult: locals.user?.showAdult,
          },
          userId,
        )
      : null,
  ]);
  const own = stats.ranking.find((row) => row.id === userId);

  return {
    state: seasonState(SEASON),
    startsAt: SEASON.startsAt,
    endsAt: SEASON.endsAt,
    goal: SEASON.goal,
    tiers: SEASON.tiers,
    completionBonus: SEASON.completionBonus,
    unlocked: stats.unlocked,
    // Le détail du calcul reste côté serveur : personne n'est désigné publiquement.
    ranking: stats.ranking
      .filter((row) => row.isPublic && row.points > 0)
      .slice(0, 10)
      .map(({ id: _id, ignored: _ignored, isPublic: _isPublic, ...row }) => row),
    points: own?.points ?? 0,
    ignored: own?.ignored ?? 0,
    waiting: library?.games.slice(0, WAITING_GAMES) ?? [],
  };
};
