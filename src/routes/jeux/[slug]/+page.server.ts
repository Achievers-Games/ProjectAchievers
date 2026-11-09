import { error, fail } from '@sveltejs/kit';
import { copiesFor, copyKey, nextCopy } from '#lib/collection';
import { db } from '#lib/server/db';
import { ensureGameTexts, localizeAchievements } from '#lib/server/achievement-texts';
import { compareGame, seasonStartedGames, visibleGames } from '#lib/server/queries';
import { friendList } from '#lib/server/social';
import { GUIDE_ORDER, countChecklist, gameGuidesWhere, isBuried } from '#lib/server/guides';
import { publicUser } from '#lib/server/queries';
import { censor } from '#lib/profanity';
import { compareAchievements } from '#lib/compare';
import { SEASON, seasonState } from '#lib/season';
import { getLocale } from '#lib/paraglide/runtime';
import { lureGameFor } from '#lib/server/lure-games';
import type { Actions, PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

const OFFICIAL_GUIDE = { curatedKey: { not: null }, status: 'PUBLISHED' } as const;

/**
 * Le relevé des manquables : celui de cette version, sinon celui d'une autre version du jeu,
 * que la page signale avec un lien.
 */
function missablesOf(
  game: { guideReviewedAt: Date | null; achievements: { missable: boolean }[] },
  others: { slug: string; guideReviewedAt: Date | null; _count: { achievements: number } }[],
) {
  const count = game.achievements.filter((a) => a.missable).length;
  if (game.guideReviewedAt) return { count, elsewhere: null, partial: false };
  const other = others.find((version) => version.guideReviewedAt);
  if (other) return { count: other._count.achievements, elsewhere: other.slug, partial: false };
  // Un relevé en cours signale déjà ses manquables, sans promettre qu'il n'y en a pas d'autres.
  return count ? { count, elsewhere: null, partial: true } : null;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const revealed = url.searchParams.has('caches');
  const game = await db.game.findUnique({
    where: { slug: params.slug },
    include: {
      achievements: {
        orderBy: [{ globalRarity: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
        include: { _count: { select: { guides: { where: OFFICIAL_GUIDE } } } },
      },
    },
  });
  if (!game || (game.adultOnly && !locals.user?.showAdult)) {
    error(404, m.game_not_found());
  }

  const withHandle = url.searchParams.get('avec')?.trim() || null;

  const viewerId = locals.user?.id;
  const [progress, unlocks, players, others, rival, friends, guides, lure] = await Promise.all([
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
            guideReviewedAt: true,
            _count: { select: { achievements: { where: { missable: true } } } },
            players: {
              where: { userId: locals.user?.id ?? '' },
              select: { completion: true },
            },
          },
        })
      : [],
    locals.user && withHandle
      ? compareGame({ viewerId: locals.user.id, gameId: game.id, handle: withHandle })
      : null,
    locals.user ? friendList(locals.user.id) : [],
    db.guide.findMany({
      where: gameGuidesWhere(game),
      orderBy: GUIDE_ORDER,
      take: 50,
      select: {
        id: true,
        title: true,
        contentMd: true,
        locale: true,
        score: true,
        curatedKey: true,
        createdAt: true,
        updatedAt: true,
        author: { select: publicUser },
        _count: { select: { checks: { where: { userId: viewerId ?? '' } } } },
      },
    }),
    // La fiche Lure du jeu et son temps pour le 100 %, si Lure le connaît : jamais attendu.
    lureGameFor(game).catch(() => null),
  ]);

  // Seuls les amis qui possèdent cette version ont quelque chose à comparer.
  const owning = new Set(
    locals.user && friends.length
      ? (
          await db.userGame.findMany({
            where: {
              gameId: game.id,
              hidden: false,
              userId: { in: friends.map((friend) => friend.id) },
              // Un profil privé ne se compare pas : le proposer ne mènerait qu'à une page vide.
              user: { isPublic: true },
            },
            select: { userId: true },
          })
        ).map((row) => row.userId)
      : [],
  );

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

  const rows = achievements.map((a) => {
    const unlocked = unlockedAt.get(a.id) ?? null;
    // Un succès caché reste masqué tant que le joueur ne l'a pas obtenu ou demandé à le voir.
    const secret = a.hidden && !unlocked;
    const masked = secret && !revealed;
    return {
      id: a.id,
      secret,
      masked,
      trophyType: a.trophyType,
      globalRarity: a.globalRarity,
      name: masked ? m.achievement_hidden() : a.name,
      description: masked ? '' : a.description,
      iconUrl: masked ? null : unlocked ? a.iconUrl : (a.iconLockedUrl ?? a.iconUrl),
      unlockedAt: unlocked,
      // Même caché, un succès manquable se signale : c'est avant de jouer qu'il faut le savoir.
      missable: a.missable,
      guided: a._count.guides > 0,
    };
  });

  const clean = (text: string, from: string | null) =>
    locals.user?.allowProfanity ? text : censor(text, from);

  return {
    game: { ...game, achievements: undefined },
    // Les guides complets du jeu : on les lit sur leur propre page, ici seulement la liste.
    guides: guides.map((guide) => ({
      id: guide.id,
      title: clean(guide.title ?? '', guide.locale),
      official: guide.curatedKey !== null,
      buried: isBuried(guide),
      score: guide.score,
      author: guide.author,
      createdAt: guide.createdAt,
      updatedAt: guide.updatedAt,
      steps: countChecklist(guide.contentMd),
      checked: guide._count.checks,
    })),
    achievements: rows,
    compare: rival
      ? {
          user: rival.user,
          progress: rival.progress,
          // Deux versions différentes ne se comparent pas : sans l'une des deux progressions,
          // la page explique pourquoi au lieu d'afficher des marques trompeuses.
          ...(rival.progress && progress
            ? compareAchievements(rows, rival.unlocked)
            : {
                visible: [] as string[],
                counts: { common: 0, mine: 0, theirs: 0, neither: 0 },
              }),
        }
      : null,
    friends: friends.filter((friend) => owning.has(friend.id)),
    revealed,
    missables: missablesOf(game, others),
    progress,
    season,
    players,
    lure,
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
