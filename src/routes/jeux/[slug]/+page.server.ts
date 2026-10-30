import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { visibleGames } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const game = await db.game.findUnique({
    where: { slug: params.slug },
    include: {
      achievements: {
        orderBy: [{ globalRarity: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      },
    },
  });
  if (!game || (game.adultOnly && !locals.user?.showAdult)) {
    error(404, 'Ce jeu est introuvable.');
  }

  const [progress, unlocks, players, others] = await Promise.all([
    locals.user
      ? db.userGame.findUnique({
          where: { userId_gameId: { userId: locals.user.id, gameId: game.id } },
        })
      : null,
    locals.user
      ? db.userAchievement.findMany({
          where: { userId: locals.user.id, achievement: { gameId: game.id } },
          select: { achievementId: true, unlockedAt: true },
        })
      : [],
    db.userGame.count({ where: { gameId: game.id, user: { isPublic: true } } }),
    game.familyKey
      ? db.game.findMany({
          where: {
            familyKey: game.familyKey,
            NOT: { id: game.id },
            ...visibleGames(locals.user?.showAdult),
          },
          select: {
            slug: true,
            platform: true,
            players: {
              where: { userId: locals.user?.id ?? '' },
              select: { completion: true },
            },
          },
        })
      : [],
  ]);

  const unlockedAt = new Map(unlocks.map((u) => [u.achievementId, u.unlockedAt]));

  return {
    game: { ...game, achievements: undefined },
    achievements: game.achievements.map((a) => {
      const unlocked = unlockedAt.get(a.id) ?? null;
      // Un succès caché reste masqué tant que le joueur ne l'a pas obtenu.
      const masked = a.hidden && !unlocked;
      return {
        id: a.id,
        trophyType: a.trophyType,
        globalRarity: a.globalRarity,
        name: masked ? 'Succès caché' : a.name,
        description: masked ? '' : a.description,
        iconUrl: masked ? null : unlocked ? a.iconUrl : (a.iconLockedUrl ?? a.iconUrl),
        unlockedAt: unlocked,
      };
    }),
    progress,
    players,
    versions: others.map((other) => ({
      slug: other.slug,
      platform: other.platform,
      completion: other.players[0]?.completion ?? null,
    })),
  };
};
