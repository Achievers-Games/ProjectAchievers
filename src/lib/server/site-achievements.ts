import { Prisma, type Platform, type Provider } from '@prisma/client';
import { m } from '$lib/paraglide/messages';
import { SEASON, seasonState } from '$lib/season';
import {
  CLAN_CODES,
  EVENT_CODES,
  SECRET_CODES,
  SITE_CATEGORIES,
  SITE_CODES,
  genreOf,
  groupSeries,
  seriesOf,
  stepLevel,
  type BaseCode,
  type ClanKey,
  type SiteCode,
} from '$lib/site-achievements';
import { getLocale } from '$lib/paraglide/runtime';
import { localizeAchievements } from './achievement-texts';
import { checkClanAchievements, clanFacts } from './clan-achievements';
import { rateLimit } from './rate-limit';
import { db } from './db';
import {
  GENRE_ICON,
  ICON_PATHS,
  SERIES_ICON,
  SITE_ICON,
  UNKNOWN_ICON,
  type IconName,
} from './site-icons';
import { seasonStats, userCards, visibleGames } from './queries';
import { publishChat } from './sync/events';
import {
  evaluateSite,
  markBursts,
  type SeasonFacts,
  type SiteFacts,
  type SiteProof,
} from './site-rules';

const GAME_PROVIDERS: Provider[] = ['STEAM', 'PSN', 'XBOX', 'RETRO', 'BLIZZARD'];
const GAME_PLAYER = { accounts: { some: { provider: { in: GAME_PROVIDERS } } } };
/** Être le premier ne compte qu'à partir d'ici : les finitions plus anciennes sont de l'histoire. */
const LAUNCH = new Date('2026-11-03T00:00:00Z');
/** En dessous, être le premier ou le seul sur un jeu ne prouve rien. */
const MIN_PLAYERS = 5;
/** Plus ancien, c'est une valeur par défaut de plateforme, pas une vraie date. */
const FIRST_REAL_DATE = new Date('2000-01-01T00:00:00Z');
const SECRETS_FOR_LAST_WORD = 10;
const SEASON_CACHE = 10 * 60 * 1000;
const CLAN_CHECK_EVERY = 10 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const CHECKBOX = /^\s*[-*] \[[ x]\]/gim;

let seasonCache: { at: number; stats: Awaited<ReturnType<typeof seasonStats>> } | null = null;

async function seasonFacts(userId: string, now: number): Promise<SeasonFacts | null> {
  const state = seasonState(SEASON, now);
  if (state === 'soon') return null;
  if (!seasonCache || now - seasonCache.at > SEASON_CACHE) {
    seasonCache = { at: now, stats: await seasonStats(SEASON) };
  }
  const { ranking, unlocked } = seasonCache.stats;
  const rank = ranking.filter((row) => row.isPublic).findIndex((row) => row.id === userId);
  return {
    startsAt: SEASON.startsAt.getTime(),
    endsAt: SEASON.endsAt.getTime(),
    tiers: SEASON.tiers,
    points: ranking.find((row) => row.id === userId)?.points ?? 0,
    rank: rank < 0 ? null : rank + 1,
    ended: state === 'ended',
    goalReached: unlocked >= SEASON.goal,
  };
}

async function finishedGuide(userId: string) {
  const checked = await db.guideCheck.groupBy({
    by: ['guideId'],
    where: { userId },
    _count: { _all: true },
  });
  const guides = await db.guide.findMany({
    where: { id: { in: checked.map((row) => row.guideId) }, status: 'PUBLISHED' },
    select: { id: true, contentMd: true },
  });
  return guides.some((guide) => {
    const items = guide.contentMd.match(CHECKBOX)?.length ?? 0;
    const done = checked.find((row) => row.guideId === guide.id)?._count._all ?? 0;
    return items > 0 && done >= items;
  });
}

async function sharedUnlock(userId: string, friends: string[]) {
  if (!friends.length) return null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT mine."achievementId" AS id FROM "UserAchievement" mine
    JOIN "UserAchievement" other
      ON other."achievementId" = mine."achievementId"
     AND other."unlockedAt"::date = mine."unlockedAt"::date
    WHERE mine."userId" = ${userId} AND other."userId" IN (${Prisma.join(friends)})
      AND mine."unlockedAt" >= ${FIRST_REAL_DATE}
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

async function sharedFinish(userId: string, friends: string[]) {
  if (!friends.length) return null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT mine."gameId" AS id FROM "UserGame" mine
    JOIN "UserGame" other
      ON other."gameId" = mine."gameId" AND other.completion >= 100
     AND other."lastUnlockedAt"::date = mine."lastUnlockedAt"::date
    WHERE mine."userId" = ${userId} AND mine.completion >= 100
      AND other."userId" IN (${Prisma.join(friends)})
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

const NO_FRIEND_COUNTS: SiteFacts['friendCounts'] = {
  duo: 0,
  revenge: 0,
  teammates: 0,
  synchro: 0,
  prescriber: 0,
  same_taste: 0,
};

/** Ce que le joueur a fait avec ses amis : jeux finis à deux, revanches, jours en synchro… */
async function friendCounts(userId: string, friends: string[]) {
  if (!friends.length) return NO_FRIEND_COUNTS;
  const ids = Prisma.join(friends);
  const [finishes, synchro, prescriber, taste] = await Promise.all([
    db.$queryRaw<{ duo: number; revenge: number; teammates: number }[]>`
      SELECT count(DISTINCT mine."gameId")::int AS duo,
        (count(DISTINCT mine."gameId")
          FILTER (WHERE other."lastUnlockedAt" < mine."lastUnlockedAt"))::int AS revenge,
        (count(DISTINCT mine."gameId") FILTER (
          WHERE abs(extract(epoch FROM other."lastUnlockedAt" - mine."lastUnlockedAt")) <= 604800
        ))::int AS teammates
      FROM "UserGame" mine
      JOIN "UserGame" other ON other."gameId" = mine."gameId" AND other.completion >= 100
       AND other."userId" IN (${ids})
      WHERE mine."userId" = ${userId} AND mine.completion >= 100 AND NOT mine.hidden`,
    db.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT mine."unlockedAt"::date)::int AS n
      FROM "UserAchievement" mine
      JOIN "Achievement" a ON a.id = mine."achievementId"
      WHERE mine."userId" = ${userId} AND mine."unlockedAt" >= ${FIRST_REAL_DATE}
        AND EXISTS (
          SELECT 1 FROM "UserAchievement" o
          JOIN "Achievement" b ON b.id = o."achievementId"
          WHERE o."userId" IN (${ids}) AND b."gameId" = a."gameId"
            AND o."unlockedAt"::date = mine."unlockedAt"::date
        )`,
    db.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT mine."gameId")::int AS n
      FROM "UserGame" mine
      WHERE mine."userId" = ${userId} AND mine.completion >= 100 AND NOT mine.hidden
        AND mine."lastUnlockedAt" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "UserGame" other
          WHERE other."gameId" = mine."gameId" AND other."userId" IN (${ids})
            AND other."unlockedCount" > 0
            AND (
              SELECT min(ua."unlockedAt") FROM "UserAchievement" ua
              JOIN "Achievement" a ON a.id = ua."achievementId"
              WHERE ua."userId" = other."userId" AND a."gameId" = other."gameId"
            ) > mine."lastUnlockedAt"
        )`,
    db.$queryRaw<{ n: number }[]>`
      SELECT coalesce(max(shared), 0)::int AS n FROM (
        SELECT count(*) AS shared FROM "UserGame" mine
        JOIN "UserGame" other ON other."gameId" = mine."gameId" AND other."userId" IN (${ids})
        WHERE mine."userId" = ${userId}
        GROUP BY other."userId"
      ) pairs`,
  ]);
  return {
    duo: finishes[0]?.duo ?? 0,
    revenge: finishes[0]?.revenge ?? 0,
    teammates: finishes[0]?.teammates ?? 0,
    synchro: synchro[0]?.n ?? 0,
    prescriber: prescriber[0]?.n ?? 0,
    same_taste: taste[0]?.n ?? 0,
  };
}

/** Un jeu laissé à moins de 10 %, qu'un ami commence plus d'un mois après l'abandon. */
async function badInfluence(userId: string, friends: string[]) {
  if (!friends.length) return null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT mine."gameId" AS id FROM "UserGame" mine
    WHERE mine."userId" = ${userId} AND mine.completion < 10 AND mine."unlockedCount" > 0
      AND NOT mine.hidden AND mine."lastUnlockedAt" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "UserAchievement" ua
        JOIN "Achievement" a ON a.id = ua."achievementId"
        WHERE ua."userId" IN (${Prisma.join(friends)}) AND a."gameId" = mine."gameId"
        GROUP BY ua."userId"
        HAVING min(ua."unlockedAt") > mine."lastUnlockedAt" + interval '30 days'
      )
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** Trois membres, trois cartes, moins d'une semaine entre la première et la dernière. */
async function hasPerfectClan(clanId: string) {
  const rows = await db.userGame.findMany({
    where: {
      completion: { gte: 100 },
      hidden: false,
      lastUnlockedAt: { not: null },
      user: { clanMember: { clanId } },
    },
    select: { userId: true, lastUnlockedAt: true },
    orderBy: { lastUnlockedAt: 'asc' },
  });
  return rows.some((row, index) => {
    const start = row.lastUnlockedAt!.getTime();
    const within = rows.slice(index).filter((next) => {
      return next.lastUnlockedAt!.getTime() - start <= WEEK;
    });
    return new Set(within.map((next) => next.userId)).size >= 3;
  });
}

/** Premier à finir un jeu, ou seul à l'avoir fini, parmi au moins `MIN_PLAYERS` joueurs. */
async function pioneer(userId: string, alone: boolean) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT mine."gameId" AS id FROM "UserGame" mine
    WHERE mine."userId" = ${userId} AND mine.completion >= 100 AND NOT mine.hidden
      AND mine."lastUnlockedAt" >= ${LAUNCH}
      AND (SELECT count(*) FROM "UserGame" p WHERE p."gameId" = mine."gameId") >= ${MIN_PLAYERS}
      AND NOT EXISTS (
        SELECT 1 FROM "UserGame" other
        WHERE other."gameId" = mine."gameId" AND other."userId" <> mine."userId"
          AND other.completion >= 100
          AND (${alone} OR other."lastUnlockedAt" < mine."lastUnlockedAt")
      )
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

async function loadFacts(userId: string, earned: Set<string>): Promise<SiteFacts | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      timeZone: true,
      frame: true,
      showcaseCustom: true,
      clanMember: { select: { clanId: true, owner: true } },
      accounts: { select: { provider: true } },
    },
  });
  if (!user) return null;

  const now = Date.now();
  // Ces calculs croisent d'autres joueurs : inutile de les rejouer une fois le succès obtenu.
  const missing = (code: SiteCode) => !earned.has(code);
  const clan = user.clanMember;
  const [games, unlocks, cards, friendships] = await Promise.all([
    db.userGame.findMany({
      where: { userId, hidden: false },
      select: {
        gameId: true,
        unlockedCount: true,
        totalCount: true,
        completion: true,
        playtimeMinutes: true,
        lastPlayedAt: true,
        lastUnlockedAt: true,
        game: { select: { name: true, platform: true, tags: true } },
      },
    }),
    db.$queryRaw<
      {
        unlockedAt: Date;
        gameId: string;
        achievementId: string;
        platform: Platform;
        globalRarity: number | null;
      }[]
    >`
      SELECT ua."unlockedAt", a."gameId", a.id AS "achievementId", g.platform, a."globalRarity"
      FROM "UserAchievement" ua
      JOIN "Achievement" a ON a.id = ua."achievementId"
      JOIN "Game" g ON g.id = a."gameId"
      JOIN "UserGame" ug ON ug."userId" = ua."userId" AND ug."gameId" = a."gameId"
      WHERE ua."userId" = ${userId} AND NOT ug.hidden AND ua."unlockedAt" >= ${FIRST_REAL_DATE}`,
    userCards(userId, true),
    db.friendship.findMany({
      where: { accepted: true, OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    }),
  ]);
  const friends = friendships.map((f) =>
    f.requesterId === userId ? f.addresseeId : f.requesterId,
  );

  const [
    clanSize,
    messages,
    comments,
    reactions,
    pushes,
    upheld,
    feedback,
    guideDone,
    soulmates,
    twins,
    perfectClan,
    firstEver,
    onlyOne,
    season,
    withFriends,
    influence,
  ] = await Promise.all([
    clan ? db.clanMember.count({ where: { clanId: clan.clanId } }) : 0,
    db.message.count({ where: { authorId: userId } }),
    db.comment.count({ where: { authorId: userId, status: 'PUBLISHED' } }),
    db.commentReaction.count({ where: { comment: { authorId: userId, status: 'PUBLISHED' } } }),
    db.pushSubscription.count({ where: { userId } }),
    db.report.count({ where: { reporterId: userId, upheld: true } }),
    db.feedback.count({ where: { userId, status: 'DONE' } }),
    missing('guide_done') && finishedGuide(userId),
    missing('soulmates') ? sharedUnlock(userId, friends) : null,
    missing('twins') ? sharedFinish(userId, friends) : null,
    missing('perfect_clan') && clan !== null && hasPerfectClan(clan.clanId),
    missing('first_ever') ? pioneer(userId, false) : null,
    missing('only_one') ? pioneer(userId, true) : null,
    seasonFacts(userId, now),
    // Inutile de recompter ce qui a déjà atteint son dernier palier.
    missing('duo_15') ||
    missing('revenge_15') ||
    missing('teammates_10') ||
    missing('synchro_50') ||
    missing('prescriber_15') ||
    missing('same_taste_100')
      ? friendCounts(userId, friends)
      : null,
    missing('bad_influence') ? badInfluence(userId, friends) : null,
  ]);

  const providers = user.accounts.map((account) => account.provider);
  return {
    now,
    createdAt: user.createdAt.getTime(),
    timeZone: user.timeZone,
    platforms: [...new Set(providers.filter((p) => GAME_PROVIDERS.includes(p)))] as Platform[],
    games: games.map((g) => ({
      gameId: g.gameId,
      name: g.game.name,
      platform: g.game.platform,
      unlocked: g.unlockedCount,
      total: g.totalCount,
      completion: g.completion,
      playtime: g.playtimeMinutes,
      played: g.lastPlayedAt !== null,
      lastAt: g.lastUnlockedAt?.getTime() ?? null,
      tags: g.game.tags,
    })),
    unlocks: markBursts(
      unlocks.map((u) => ({
        at: u.unlockedAt.getTime(),
        gameId: u.gameId,
        achievementId: u.achievementId,
        platform: u.platform,
        rarity: u.globalRarity,
      })),
      SEASON.burstPerSecond,
      SEASON.burstPerMinute,
    ),
    cards: cards.map((card) => ({
      gameId: card.id,
      tier: card.tier,
      copies: card.copies,
      lastAt: card.lastUnlockedAt?.getTime() ?? null,
      next: card.next !== null,
    })),
    frame: user.frame !== null,
    showcase: user.showcaseCustom,
    push: pushes > 0,
    friends: friends.length,
    clan: clan && { owner: clan.owner, size: clanSize },
    messages,
    comments,
    reactions,
    guideDone,
    upheldReport: upheld > 0,
    doneFeedback: feedback > 0,
    season,
    soulmates,
    twins,
    perfectClan,
    firstEver,
    onlyOne,
    friendCounts: withFriends ?? NO_FRIEND_COUNTS,
    badInfluence: influence,
  };
}

/**
 * Attribue ce qui est mérité. Un succès obtenu reste acquis ; la toute première évaluation
 * reste muette, pour ne pas inonder un joueur qui arrive avec tout son historique.
 */
export async function checkSiteAchievements(userId: string) {
  // Le clan se relit avec ses membres, mais pas à chaque synchro de chacun d'eux.
  const member = await db.clanMember.findUnique({ where: { userId }, select: { clanId: true } });
  if (member && rateLimit(`clan-succes:${member.clanId}`, 1, CLAN_CHECK_EVERY)) {
    await checkClanAchievements(member.clanId).catch((cause) =>
      console.error('Succès de clan :', cause),
    );
  }
  const rows = await db.siteUnlock.findMany({
    where: { userId },
    select: { code: true, proof: true },
  });
  const earned = new Set(rows.map((row) => row.code));
  const unexplained = rows.filter((row) => row.proof === null).map((row) => row.code);
  const settled = new Set(rows.filter((row) => row.proof !== null).map((row) => row.code));
  const facts = await loadFacts(userId, settled);
  if (!facts) return [];

  const { codes, proof } = evaluateSite(facts);
  const gained = codes.filter((code) => !earned.has(code));
  const secrets = [...earned, ...gained].filter((code) => SECRET_CODES.has(code)).length;
  if (secrets >= SECRETS_FOR_LAST_WORD && !earned.has('last_word')) gained.push('last_word');

  const json = (code: string) =>
    (proof(code as SiteCode) ?? undefined) as Prisma.InputJsonValue | undefined;
  // Un succès obtenu avant l'enregistrement des preuves reçoit la sienne dès qu'elle se retrouve.
  const explained = unexplained.filter((code) => json(code) !== undefined);
  await Promise.all(
    explained.map((code) =>
      db.siteUnlock.update({
        where: { userId_code: { userId, code } },
        data: { proof: json(code) },
      }),
    ),
  );
  if (!gained.length) return gained;

  await db.siteUnlock.createMany({
    data: gained.map((code) => ({ userId, code, proof: json(code) })),
    skipDuplicates: true,
  });
  if (rows.length > 0) publishChat(userId, { type: 'site-achievement', codes: gained });
  return gained;
}

/** Un joueur qui ne revient pas reçoit quand même ses succès : le site les calcule pour lui. */
export async function reviewNewPlayers() {
  const players = await db.user.findMany({
    where: { ...GAME_PLAYER, siteUnlocks: { none: {} } },
    select: { id: true },
  });
  for (const { id } of players) await checkSiteAchievements(id);
}

/** Pour les gestes qui ne laissent aucune trace à relire : un clan quitté, un pseudo changé. */
export async function grantSiteAchievement(userId: string, code: SiteCode) {
  const { count } = await db.siteUnlock.createMany({
    data: [{ userId, code }],
    skipDuplicates: true,
  });
  if (count > 0) publishChat(userId, { type: 'site-achievement', codes: [code] });
}

type Message = (params?: Record<string, string | number>) => string;
const message = (key: string, params?: Record<string, string | number>) =>
  (m as unknown as Record<string, Message>)[key]!(params);
/** Les paliers d'une série d'amis ou de clan partagent un titre. */
export const siteTitle = (code: string) => message(`ach_${seriesOf(code)?.key ?? code}_title`);

/** Les genres partagent un modèle de texte ; les autres succès ont le leur. */
function siteText(code: string) {
  const series = seriesOf(code);
  if (series) return message(`ach_${series.key}_text`, { count: series.count });
  const genre = genreOf(code);
  if (!genre) return message(`ach_${code}_text`);
  const params = { genre: message(`genre_${genre.key}`), count: genre.count };
  return message(genre.count === 1 ? 'ach_genre_one_text' : 'ach_genre_many_text', params);
}

const iconOf = (code: string): IconName => {
  const genre = genreOf(code);
  const series = seriesOf(code);
  if (genre) return GENRE_ICON[genre.key];
  return series ? SERIES_ICON[series.key] : SITE_ICON[code as BaseCode];
};
const CATEGORY_OF = new Map(
  Object.entries(SITE_CATEGORIES).flatMap(([category, codes]) =>
    codes.map((code) => [code as string, category]),
  ),
);

/** Ce qu'il faut pour fêter un succès à l'écran : il appartient déjà au joueur. */
export const sitePop = (code: string) => ({
  title: siteTitle(code),
  icon: ICON_PATHS[iconOf(code)],
  category: CATEGORY_OF.get(code) ?? 'start',
  level: genreOf(code)?.level ?? seriesOf(code)?.level ?? 0,
});

export const siteAchievementCount = (userId: string) =>
  db.siteUnlock.count({ where: { userId, code: { notIn: [...EVENT_CODES] } } });

/** Retrouve les noms derrière les preuves, sans montrer un jeu adulte à qui les masque. */
async function proofLabels(proofs: SiteProof[], showAdult: boolean) {
  const game = showAdult ? {} : { adultOnly: false };
  const [games, achievements] = await Promise.all([
    db.game.findMany({
      where: { id: { in: proofs.flatMap((proof) => proof.games ?? []) }, ...game },
      select: { id: true, name: true, slug: true, coverUrl: true, headerUrl: true },
    }),
    db.achievement.findMany({
      where: { id: { in: proofs.flatMap((proof) => proof.achievements ?? []) }, game },
      select: { id: true, name: true, iconUrl: true, game: { select: { name: true } } },
    }),
  ]);
  const localized = await localizeAchievements(achievements, getLocale());
  return {
    games: new Map(games.map((row) => [row.id, row])),
    achievements: new Map(localized.map((row) => [row.id, row])),
  };
}

/** Le tableau d'un joueur. Un secret ne se lit qu'une fois obtenu par celui qui regarde. */
export async function siteAchievementBoard(
  userId: string,
  viewerId: string | null,
  showAdult = false,
) {
  const [owned, viewed, counts, players] = await Promise.all([
    db.siteUnlock.findMany({
      where: { userId },
      select: { code: true, unlockedAt: true, proof: true },
    }),
    viewerId ? db.siteUnlock.findMany({ where: { userId: viewerId }, select: { code: true } }) : [],
    db.siteUnlock.groupBy({ by: ['code'], _count: { _all: true } }),
    db.user.count({ where: GAME_PLAYER }),
  ]);
  const dates = new Map(owned.map((row) => [row.code, row.unlockedAt]));
  const seen = new Set(viewed.map((row) => row.code));
  const holders = new Map(counts.map((row) => [row.code, row._count._all]));
  // Un joueur qui a délié ses comptes garde ses succès : le total peut dépasser la base.
  const share = (code: string) =>
    Math.min(100, ((holders.get(code) ?? 0) / Math.max(1, players)) * 100);
  const revealedCode = (code: string) => !SECRET_CODES.has(code) || seen.has(code);
  const proofs = new Map(
    owned
      .filter((row) => row.proof !== null && revealedCode(row.code))
      .map((row) => [row.code, row.proof as SiteProof]),
  );
  const labels = await proofLabels([...proofs.values()], showAdult);
  const proofOf = (code: string) => {
    const proof = proofs.get(code);
    const games = (proof?.games ?? []).flatMap((id) => labels.games.get(id) ?? []);
    const achievements = (proof?.achievements ?? []).flatMap(
      (id) => labels.achievements.get(id) ?? [],
    );
    return games.length || achievements.length ? { games, achievements } : null;
  };

  let index = 0;
  const icons = new Set<IconName>([UNKNOWN_ICON]);
  const categories = Object.entries(SITE_CATEGORIES).map(([category, codes]) => ({
    category,
    earned: codes.filter((code) => dates.has(code)).length,
    size: codes.length,
    // Les paliers d'un même succès forment une carte : le dernier obtenu, puis le suivant à viser.
    items: groupSeries(codes as readonly string[]).map((steps) => {
      const reached = steps.findLastIndex((code) => dates.has(code));
      const target = steps.find((code) => !dates.has(code)) ?? steps.at(-1)!;
      const revealed = revealedCode(target);
      const icon = revealed ? iconOf(target) : UNKNOWN_ICON;
      icons.add(icon);
      const levelOf = (code: string, at: number) =>
        genreOf(code)?.level ?? seriesOf(code)?.level ?? stepLevel(at, steps.length);
      return {
        // Le numéro n'apprend rien, contrairement au code d'un secret.
        key: index++,
        code: revealed ? target : null,
        title: revealed ? siteTitle(target) : null,
        text: revealed ? siteText(target) : null,
        // La date et le badge sont ceux du dernier palier obtenu.
        unlockedAt: reached >= 0 ? (dates.get(steps[reached]!) ?? null) : null,
        complete: dates.has(target),
        icon,
        level: revealed && reached >= 0 ? levelOf(steps[reached]!, reached) : 0,
        proof: reached >= 0 ? proofOf(steps[reached]!) : null,
        // Comme la date : la part des joueurs qui ont le palier obtenu, pas celui à viser.
        rarity: revealed ? share(reached >= 0 ? steps[reached]! : target) : null,
        // Seul le joueur lui-même reçoit des idées de jeux, chargées à la demande.
        suggest: userId === viewerId && !dates.has(target) && suggestable(target),
        steps:
          steps.length > 1
            ? steps.map((code, at) => ({
                title: siteTitle(code),
                earned: dates.has(code),
                level: levelOf(code, at),
              }))
            : [],
      };
    }),
  }));
  const permanent = SITE_CODES.filter((code) => !EVENT_CODES.has(code));
  return {
    categories,
    // Chaque dessin ne part qu'une fois, même partagé par plusieurs succès.
    icons: Object.fromEntries([...icons].map((name) => [name, ICON_PATHS[name]])),
    earned: permanent.filter((code) => dates.has(code)).length,
    total: permanent.length,
  };
}

const SUGGESTED = 3;
/** Ces succès se gagnent en finissant n'importe quel jeu : le plus avancé est le meilleur choix. */
const ANY_FINISH = /^(cards_\d+|game_\d+|season_finish_\d+)$/;
const suggestable = (code: string) => genreOf(code) !== null || ANY_FINISH.test(code);

/**
 * Les jeux qui rapprochent d'un succès du site : d'abord ceux de la bibliothèque, du plus avancé
 * au moins avancé ; sinon les plus joués du site, sur une plateforme déjà liée.
 */
export async function siteSuggestions(userId: string, code: string, showAdult = false) {
  const genre = genreOf(code);
  if (!suggestable(code)) return null;
  const game = {
    ...visibleGames(showAdult),
    ...(genre ? { tags: { hasSome: [...genre.tags] } } : {}),
    totalAchievements: { gt: 0 },
  } satisfies Prisma.GameWhereInput;
  const gameSelect = { name: true, slug: true, coverUrl: true, headerUrl: true } as const;

  const mine = await db.userGame.findMany({
    where: { userId, hidden: false, completion: { lt: 100 }, game },
    orderBy: [{ completion: 'desc' }, { unlockedCount: 'desc' }],
    take: SUGGESTED,
    select: {
      completion: true,
      unlockedCount: true,
      totalCount: true,
      game: { select: gameSelect },
    },
  });
  if (mine.length || !genre) {
    return {
      owned: true,
      games: mine.map((row) => ({
        ...row.game,
        completion: row.completion,
        left: Math.max(0, row.totalCount - row.unlockedCount),
      })),
    };
  }

  const accounts = await db.linkedAccount.findMany({
    where: { userId, provider: { in: GAME_PROVIDERS } },
    select: { provider: true },
  });
  const platforms = [...new Set(accounts.map((account) => account.provider))] as Platform[];
  const others = await db.game.findMany({
    where: { ...game, platform: { in: platforms }, players: { none: { userId } } },
    orderBy: { players: { _count: 'desc' } },
    take: SUGGESTED,
    select: { ...gameSelect, totalAchievements: true },
  });
  return {
    owned: false,
    games: others.map(({ totalAchievements, ...row }) => ({
      ...row,
      completion: null,
      left: totalAchievements,
    })),
  };
}

/** Les succès d'un clan, avec l'avancée de chaque série ; un secret n'apparaît qu'une fois gagné. */
export async function clanAchievementBoard(clanId: string) {
  const [owned, facts] = await Promise.all([
    db.clanUnlock.findMany({ where: { clanId }, select: { code: true, unlockedAt: true } }),
    clanFacts(clanId),
  ]);
  const dates = new Map(owned.map((row) => [row.code, row.unlockedAt]));
  const secrets = [...CLAN_CODES].filter((code) => SECRET_CODES.has(code) && dates.has(code));
  const icons = new Set<IconName>();
  const items = groupSeries([...SITE_CATEGORIES.clan, ...secrets]).map((steps) => {
    const reached = steps.findLastIndex((code) => dates.has(code));
    const target = steps.find((code) => !dates.has(code)) ?? steps.at(-1)!;
    const series = seriesOf(target);
    const icon = iconOf(target);
    icons.add(icon);
    return {
      code: target,
      title: siteTitle(target),
      text: siteText(target),
      icon,
      secret: SECRET_CODES.has(target),
      unlockedAt: reached >= 0 ? (dates.get(steps[reached]!) ?? null) : null,
      complete: dates.has(target),
      level: reached >= 0 ? (seriesOf(steps[reached]!)?.level ?? 0) : 0,
      // L'avancée vers le palier visé : 1 234 succès sur 10 000.
      progress:
        series && facts && !dates.has(target)
          ? { value: facts.counts[series.key as ClanKey], goal: series.count }
          : null,
      steps:
        steps.length > 1
          ? steps.map((code) => ({
              title: siteText(code),
              earned: dates.has(code),
              level: seriesOf(code)?.level ?? 0,
            }))
          : [],
    };
  });
  const permanent = SITE_CATEGORIES.clan as readonly string[];
  return {
    items,
    icons: Object.fromEntries([...icons].map((name) => [name, ICON_PATHS[name]])),
    earned: permanent.filter((code) => dates.has(code)).length,
    total: permanent.length,
  };
}
