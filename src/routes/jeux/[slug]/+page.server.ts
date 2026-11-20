import { error, fail } from '@sveltejs/kit';
import { copiesFor, copyKey, nextCopy } from '#lib/collection';
import { db } from '#lib/server/db';
import { serverTiming } from '#lib/server/server-timing';
import { ensureGameTexts } from '#lib/server/achievement-texts';
import { compareGame, seasonStartedGames, visibleGames } from '#lib/server/queries';
import { gamePlayer } from '#lib/server/queries/compare';
import { friendList } from '#lib/server/social';
import { GUIDE_ORDER, countChecklist, gameGuidesWhere, isBuried } from '#lib/server/guides';
import { publicUser } from '#lib/server/queries';
import { censor } from '#lib/profanity';
import { compareAchievements, compareBucket } from '#lib/compare';
import { SEASON, seasonState } from '#lib/season';
import { getLocale } from '#lib/paraglide/runtime';
import { lureGameFor } from '#lib/server/lure-games';
import { excludedSteamUnlocks } from '#lib/server/steam-integrity';
import { addSteamProof, type ProofFailure } from '#lib/server/steam-proof';
import { rateLimit } from '#lib/server/rate-limit';
import { completionTimes } from '#lib/server/completion-time';
import { artNow } from '#lib/server/sync/content';
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

export const load: PageServerLoad = async ({ params, locals, url, depends, setHeaders }) => {
  const timing = serverTiming();
  const { mark } = timing;
  depends('app:sync');
  const revealed = url.searchParams.has('caches');
  const game = await db.game.findUnique({
    where: { slug: params.slug },
  });
  if (!game || (game.adultOnly && !locals.user?.showAdult)) {
    error(404, m.game_not_found());
  }

  mark('game_query');
  // Une fiche ouverte avant que la tâche de fond n'ait lu sa capture la demande en passant : la
  // page s'affiche sans l'attendre, la prochaine visite l'aura.
  if (!game.artCheckedAt) void artNow([game.id]).catch(() => 0);
  // `?joueur=` : la fiche du jeu telle que ce joueur l'a vécue. Elle passe avant `?avec=`.
  const ofHandle = url.searchParams.get('joueur')?.trim() || null;
  const withHandle = ofHandle ? null : url.searchParams.get('avec')?.trim() || null;

  const viewerId = locals.user?.id;
  const locale = getLocale();
  const achievementQuery = async () => {
    await timing.time('game_texts', () => ensureGameTexts(game, locale));
    return timing.time('game_achievements', () =>
      db.achievement.findMany({
        where: { gameId: game.id },
        orderBy: [{ globalRarity: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
        select: {
          id: true,
          platformAchievementId: true,
          name: true,
          description: true,
          hidden: true,
          trophyType: true,
          globalRarity: true,
          iconUrl: true,
          iconLockedUrl: true,
          missable: true,
          translations: { where: { locale }, select: { name: true, description: true } },
          guides: { where: OFFICIAL_GUIDE, select: { id: true }, take: 1 },
        },
      }),
    );
  };
  const [
    progress,
    unlocks,
    players,
    others,
    rival,
    friends,
    guides,
    lure,
    times,
    achievements,
    player,
    steamReview,
  ] = await Promise.all([
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
    completionTimes([game.id]),
    achievementQuery(),
    ofHandle ? gamePlayer({ viewerId: viewerId ?? null, gameId: game.id, handle: ofHandle }) : null,
    viewerId && game.platform === 'STEAM'
      ? db.steamIntegrityReview.findFirst({
          where: { userId: viewerId, gameId: game.id },
          orderBy: { openedAt: 'desc' },
          select: {
            status: true,
            suspendedAt: true,
            snapshot: true,
            proofAt: true,
            flagged: true,
            rejected: true,
          },
        })
      : null,
  ]);

  // Seuls les amis qui possèdent cette version ont quelque chose à comparer.
  mark('game_related');
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

  // Le joueur revient voir son jeu bloqué, souvent juste après la remise à zéro : relu tout de
  // suite, la page se met à jour d'elle-même quand le blocage tombe.
  if (viewerId && steamReview?.status !== 'APPROVED' && steamReview && (!player || player.self)) {
    void import('#lib/server/sync/live').then(({ recheckBlockedSteam }) =>
      recheckBlockedSteam([viewerId]).catch(() => undefined),
    );
  }
  const mine = new Map(unlocks.map((u) => [u.achievementId, u.unlockedAt]));
  const excluded =
    steamReview && (!player || player.self) ? excludedSteamUnlocks(steamReview) : null;
  // Les dates affichées sont celles du joueur regardé, sinon celles du visiteur.
  const unlockedAt = player
    ? new Map(player.unlocks.map((u) => [u.achievementId, u.unlockedAt]))
    : mine;

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
  mark('game_ownership');
  const started = locals.user ? await seasonStartedGames(locals.user.id) : new Set<string>();
  mark('game_season');
  const unfinished = !progress || owned.some((version) => version.completion < 100);
  const counts = owned.some((version) => version.completion < 100 && started.has(version.id));
  const season =
    locals.user && state !== 'ended' && game.totalAchievements > 0 && unfinished
      ? { state, counts }
      : null;

  const rows = achievements.map((a) => {
    const [translation] = a.translations;
    const unlocked = unlockedAt.get(a.id) ?? null;
    const excludedAt = unlocked ? null : (excluded?.get(a.platformAchievementId) ?? null);
    // Un succès caché reste masqué tant que le visiteur ne l'a pas obtenu ou demandé à le voir :
    // regarder la fiche d'un autre ne dévoile pas ce qu'il a trouvé.
    const secret = a.hidden && !(player && !player.self ? mine.get(a.id) : unlocked || excludedAt);
    const masked = secret && !revealed;
    return {
      id: a.id,
      secret,
      masked,
      trophyType: a.trophyType,
      globalRarity: a.globalRarity,
      name: masked ? m.achievement_hidden() : (translation?.name ?? a.name),
      description: masked ? '' : translation?.description || a.description,
      iconUrl: masked ? null : unlocked || excludedAt ? a.iconUrl : (a.iconLockedUrl ?? a.iconUrl),
      unlockedAt: unlocked,
      excludedAt,
      // Même caché, un succès manquable se signale : c'est avant de jouer qu'il faut le savoir.
      missable: a.missable,
      guided: a.guides.length > 0,
    };
  });

  const clean = (text: string, from: string | null) =>
    locals.user?.allowProfanity ? text : censor(text, from);

  const comparing = Boolean(rival?.progress && progress);
  const requestedFilter = url.searchParams.get('succes');
  const filters = comparing ? ['commun', 'moi', 'lui'] : ['obtenus', 'restants', 'manquables'];
  const hasExcluded = rows.some((row) => row.excludedAt !== null);
  if (hasExcluded) filters.push('hors-score');
  const filter = filters.find((value) => value === requestedFilter) ?? 'tous';
  const sort = url.searchParams.get('tri') === 'nom' ? 'nom' : 'rarete';
  const theirUnlocks = new Set(rival?.unlocked);
  const visible = rows.filter((row) => {
    if (filter === 'obtenus') return row.unlockedAt !== null;
    if (filter === 'restants') return row.unlockedAt === null && row.excludedAt === null;
    if (filter === 'hors-score') return row.excludedAt !== null;
    if (filter === 'manquables') return row.missable;
    if (filter === 'tous') return true;
    const bucket = compareBucket(row, theirUnlocks);
    return bucket === (filter === 'commun' ? 'common' : filter === 'moi' ? 'mine' : 'theirs');
  });
  const collator = new Intl.Collator(locale);
  visible.sort(
    sort === 'nom'
      ? (a, b) => collator.compare(a.name, b.name)
      : (a, b) => (a.globalRarity ?? 101) - (b.globalRarity ?? 101),
  );
  const pageSize = 60;
  const requested = Number(url.searchParams.get('affiches'));
  const shown = Number.isSafeInteger(requested) ? Math.max(pageSize, requested) : pageSize;
  const displayed = visible.slice(0, shown);
  const displayedIds = new Set(displayed.map((row) => row.id));
  const comparison = rival?.progress && progress ? compareAchievements(rows, theirUnlocks) : null;
  mark('game_list');
  setHeaders(timing.headers());
  return {
    game,
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
    achievements: displayed,
    achievementTotal: rows.length,
    secrets: rows.filter((row) => row.secret).length,
    hasMissables: rows.some((row) => row.missable),
    missingMissables: rows.filter((row) => row.missable && !row.unlockedAt).length,
    filter,
    sort,
    nextAchievements: shown < visible.length ? shown + pageSize : null,
    compare: rival
      ? {
          user: rival.user,
          progress: rival.progress,
          // Deux versions différentes ne se comparent pas : sans l'une des deux progressions,
          // la page explique pourquoi au lieu d'afficher des marques trompeuses.
          ...(comparison
            ? { ...comparison, visible: comparison.visible.filter((id) => displayedIds.has(id)) }
            : {
                visible: [] as string[],
                counts: { common: 0, mine: 0, theirs: 0, neither: 0 },
              }),
        }
      : null,
    friends: friends.filter((friend) => owning.has(friend.id)),
    revealed,
    player: player && {
      user: player.user,
      self: player.self,
      progress: player.progress,
      playtimePrivate: game.platform === 'STEAM' && player.steamPlaytimeHidden,
      // Comparer n'a de sens que si le visiteur possède aussi cette version.
      canCompare: Boolean(progress && !player.self),
    },
    missables: missablesOf({ guideReviewedAt: game.guideReviewedAt, achievements }, others),
    progress,
    steamSuspended:
      steamReview?.suspendedAt && (!player || player.self) ? steamReview.status : null,
    hasExcluded,
    // Jeu bloqué : la page donne la commande Steam qui le remet à zéro pour repartir proprement.
    steamResetAppId:
      steamReview &&
      (!player || player.self) &&
      (steamReview.suspendedAt || steamReview.status === 'REJECTED')
        ? game.platformGameId
        : null,
    // Lot en attente : le joueur peut envoyer une preuve de sa progression sur une autre plateforme.
    steamProof:
      steamReview?.status === 'PENDING' && (!player || player.self)
        ? { sentAt: steamReview.proofAt }
        : null,
    season,
    players,
    lure,
    completionTime: times.get(game.id) ?? null,
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

const PROOF_ERRORS: Record<ProofFailure, () => string> = {
  proof_closed: m.steam_proof_closed,
  proof_invalid: m.steam_proof_invalid,
  proof_too_big: m.steam_proof_too_big,
};

export const actions: Actions = {
  /** Une preuve jointe à la revue Steam du joueur : capture de sa progression ailleurs, et un mot. */
  steamProof: async ({ request, params, locals }) => {
    if (!locals.user) return fail(401, { error: m.login_required() });
    if (!rateLimit(`preuve-steam:${locals.user.id}`, 5, 3_600_000)) {
      return fail(429, { error: m.steam_proof_too_many() });
    }
    const game = await db.game.findUnique({ where: { slug: params.slug }, select: { id: true } });
    if (!game) return fail(404, { error: m.game_not_found() });
    const form = await request.formData();
    const file = form.get('image');
    const result = await addSteamProof(
      locals.user.id,
      game.id,
      String(form.get('message') ?? ''),
      file instanceof File ? file : null,
    );
    if (!result.ok) return fail(400, { error: PROOF_ERRORS[result.reason]() });
    return { success: m.steam_proof_sent() };
  },

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
