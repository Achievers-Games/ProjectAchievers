import { error, fail } from '@sveltejs/kit';
import { copiesFor, copyKey, nextCopy } from '$lib/collection';
import { db } from '$lib/server/db';
import { ensureGameTexts, localizeAchievements } from '$lib/server/achievement-texts';
import { seasonStartedGames, visibleGames } from '$lib/server/queries';
import { SEASON, seasonState } from '$lib/season';
import { getLocale } from '$lib/paraglide/runtime';
import type { Actions, PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const revealed = url.searchParams.has('caches');
  const game = await db.game.findUnique({
    where: { slug: params.slug },
    include: {
      achievements: {
        orderBy: [{ globalRarity: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      },
    },
  });
  if (!game || (game.adultOnly && !locals.user?.showAdult)) {
    error(404, m.game_not_found());
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
            id: true,
            slug: true,
            platform: true,
            console: true,
            tier: true,
            players: {
              where: { userId: locals.user?.id ?? '' },
              select: { completion: true },
            },
          },
        })
      : [],
  ]);

  const unlockedAt = new Map(unlocks.map((u) => [u.achievementId, u.unlockedAt]));

  const owned = [
    ...(progress
      ? [
          {
            id: game.id,
            platform: game.platform,
            console: game.console,
            tier: game.tier,
            completion: progress.completion,
          },
        ]
      : []),
    ...others.flatMap(({ id, platform, console, tier, players: [player] }) =>
      player ? [{ id, platform, console, tier, completion: player.completion }] : [],
    ),
  ];
  const finished = owned.filter((version) => version.completion >= 100);

  const state = seasonState(SEASON);
  const started = locals.user ? await seasonStartedGames(locals.user.id) : new Set<string>();
  const unfinished = !progress || owned.some((version) => version.completion < 100);
  const counts = owned.some((version) => version.completion < 100 && started.has(version.id));
  const season =
    locals.user && state !== 'ended' && game.totalAchievements > 0 && unfinished
      ? { state, counts }
      : null;

  const locale = getLocale();
  await ensureGameTexts(game, locale);
  const achievements = await localizeAchievements(game.achievements, locale);

  return {
    game: { ...game, achievements: undefined },
    achievements: achievements.map((a) => {
      const unlocked = unlockedAt.get(a.id) ?? null;
      // Un succès caché reste masqué tant que le joueur ne l'a pas obtenu ou demandé à le voir.
      const secret = a.hidden && !unlocked;
      const masked = secret && !revealed;
      return {
        id: a.id,
        secret,
        trophyType: a.trophyType,
        globalRarity: a.globalRarity,
        name: masked ? m.achievement_hidden() : a.name,
        description: masked ? '' : a.description,
        iconUrl: masked ? null : unlocked ? a.iconUrl : (a.iconLockedUrl ?? a.iconUrl),
        unlockedAt: unlocked,
      };
    }),
    revealed,
    progress,
    season,
    players,
    versions: others.map((other) => ({
      slug: other.slug,
      platform: other.platform,
      console: other.console,
      completion: other.players[0]?.completion ?? null,
    })),
    tier: Math.max(0, ...finished.map((version) => version.tier ?? 1)),
    copies: copiesFor(new Set(finished.map(copyKey)).size),
    next: nextCopy(owned),
  };
};

export const actions: Actions = {
  /** Cache ou remontre un jeu : toutes ses versions, car elles forment une seule carte. */
  hide: async ({ request, params, locals }) => {
    if (!locals.user) return fail(401, { error: m.login_required() });
    const game = await db.game.findUnique({
      where: { slug: params.slug },
      select: { id: true, familyKey: true },
    });
    if (!game) return fail(404, { error: m.game_not_found() });

    const hidden = (await request.formData()).get('hidden') === '1';
    await db.userGame.updateMany({
      where: {
        userId: locals.user.id,
        game: game.familyKey ? { familyKey: game.familyKey } : { id: game.id },
      },
      data: { hidden },
    });
    return {
      success: hidden ? m.game_hidden_ok() : m.game_unhidden_ok(),
    };
  },
};
