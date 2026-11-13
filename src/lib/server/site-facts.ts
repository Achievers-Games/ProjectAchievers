import { Prisma, type Platform, type Provider } from '#prisma';
import { SEASON, seasonState } from '#lib/season';
import { FRIEND_SERIES, type FriendKey, type SiteCode } from '#lib/site-achievements';
import { db } from './db';
import { countChecklist } from './guides';
import { RARE_CARD, seasonStats, userCards } from './queries';
import { markBursts, type FriendProof, type SeasonFacts, type SiteFacts } from './site-rules';

/**
 * Tout ce que le site sait d'un joueur pour juger ses succès : une lecture de la base par
 * famille de règles. Les règles elles-mêmes sont dans `site-rules`, l'attribution et
 * l'affichage dans `site-achievements`.
 */
export const GAME_PROVIDERS: Provider[] = ['STEAM', 'PSN', 'XBOX', 'RETRO', 'BLIZZARD'];
export const GAME_PLAYER = { accounts: { some: { provider: { in: GAME_PROVIDERS } } } };
/** Être le premier ne compte qu'à partir d'ici : les finitions plus anciennes sont de l'histoire. */
const LAUNCH = new Date('2026-11-03T00:00:00Z');
/** En dessous, être le premier ou le seul sur un jeu ne prouve rien. */
const MIN_PLAYERS = 5;
/** Plus ancien, c'est une valeur par défaut de plateforme, pas une vraie date. */
const FIRST_REAL_DATE = new Date('2000-01-01T00:00:00Z');
const SEASON_CACHE = 10 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

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
    select: { id: true, achievementId: true, contentMd: true },
  });
  return (
    guides.find((guide) => {
      const items = countChecklist(guide.contentMd);
      const done = checked.find((row) => row.guideId === guide.id)?._count._all ?? 0;
      return items > 0 && done >= items;
    }) ?? null
  );
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

type FriendRow = { id: string; friend: string | null };
interface FriendFacts {
  counts: SiteFacts['friendCounts'];
  proofs: Partial<Record<FriendKey, FriendProof>>;
}

/**
 * Ce que le joueur a fait avec ses amis : jeux finis à deux, revanches, jours en synchro… Chaque
 * série garde ses jeux ou succès dans l'ordre où le compte a monté, avec l'ami concerné, pour
 * montrer ce qui a débloqué chaque palier. Les listes s'arrêtent au dernier palier.
 */
async function friendFacts(userId: string, friends: string[]): Promise<FriendFacts> {
  if (!friends.length) return { counts: NO_FRIEND_COUNTS, proofs: {} };
  const ids = Prisma.join(friends);
  const [duo, revenge, teammates, synchro, prescriber, taste] = await Promise.all([
    // Un jeu fini à 100 % par les deux : le compte monte quand le second le termine.
    db.$queryRaw<FriendRow[]>`
      SELECT id, friend FROM (
        SELECT DISTINCT ON (mine."gameId") mine."gameId" AS id, other."userId" AS friend,
          GREATEST(mine."lastUnlockedAt", other."lastUnlockedAt") AS at
        FROM "UserGame" mine
        JOIN "UserGame" other ON other."gameId" = mine."gameId" AND other.completion >= 100
         AND other."userId" IN (${ids})
        WHERE mine."userId" = ${userId} AND mine.completion >= 100 AND NOT mine.hidden
        ORDER BY mine."gameId", at DESC
      ) done ORDER BY at ASC LIMIT ${FRIEND_SERIES.duo.at(-1)!}`,
    // Un jeu qu'un ami avait fini avant le joueur : le compte monte quand il le dépasse.
    db.$queryRaw<FriendRow[]>`
      SELECT id, friend FROM (
        SELECT DISTINCT ON (mine."gameId") mine."gameId" AS id, other."userId" AS friend,
          mine."lastUnlockedAt" AS at
        FROM "UserGame" mine
        JOIN "UserGame" other ON other."gameId" = mine."gameId" AND other.completion >= 100
         AND other."userId" IN (${ids}) AND other."lastUnlockedAt" < mine."lastUnlockedAt"
        WHERE mine."userId" = ${userId} AND mine.completion >= 100 AND NOT mine.hidden
        ORDER BY mine."gameId", other."lastUnlockedAt" DESC
      ) overtaken ORDER BY at ASC LIMIT ${FRIEND_SERIES.revenge.at(-1)!}`,
    // Deux fins à moins d'une semaine d'écart : le compte monte à la seconde fin.
    db.$queryRaw<FriendRow[]>`
      SELECT id, friend FROM (
        SELECT DISTINCT ON (mine."gameId") mine."gameId" AS id, other."userId" AS friend,
          GREATEST(mine."lastUnlockedAt", other."lastUnlockedAt") AS at
        FROM "UserGame" mine
        JOIN "UserGame" other ON other."gameId" = mine."gameId" AND other.completion >= 100
         AND other."userId" IN (${ids})
         AND abs(extract(epoch FROM other."lastUnlockedAt" - mine."lastUnlockedAt")) <= 604800
        WHERE mine."userId" = ${userId} AND mine.completion >= 100 AND NOT mine.hidden
        ORDER BY mine."gameId", at ASC
      ) team ORDER BY at ASC LIMIT ${FRIEND_SERIES.teammates.at(-1)!}`,
    // Un jour où les deux joueurs débloquent dans le même jeu : le compte monte ce jour-là.
    db.$queryRaw<FriendRow[]>`
      SELECT id, friend FROM (
        SELECT DISTINCT ON (mine."unlockedAt"::date) mine."achievementId" AS id,
          mine."unlockedAt" AS at,
          (
            SELECT o."userId" FROM "UserAchievement" o
            JOIN "Achievement" b ON b.id = o."achievementId"
            WHERE o."userId" IN (${ids}) AND b."gameId" = a."gameId"
              AND o."unlockedAt"::date = mine."unlockedAt"::date
            ORDER BY o."userId" LIMIT 1
          ) AS friend
        FROM "UserAchievement" mine
        JOIN "Achievement" a ON a.id = mine."achievementId"
        WHERE mine."userId" = ${userId} AND mine."unlockedAt" >= ${FIRST_REAL_DATE}
          AND EXISTS (
            SELECT 1 FROM "UserAchievement" o
            JOIN "Achievement" b ON b.id = o."achievementId"
            WHERE o."userId" IN (${ids}) AND b."gameId" = a."gameId"
              AND o."unlockedAt"::date = mine."unlockedAt"::date
          )
        ORDER BY mine."unlockedAt"::date, mine."unlockedAt"
      ) days ORDER BY at ASC LIMIT ${FRIEND_SERIES.synchro.at(-1)!}`,
    // Un jeu fini avant qu'un ami ne le commence : le compte monte à son premier succès.
    db.$queryRaw<FriendRow[]>`
      SELECT id, friend FROM (
        SELECT DISTINCT ON (mine."gameId") mine."gameId" AS id, other."userId" AS friend,
          mine."lastUnlockedAt" AS finished,
          (
            SELECT min(ua."unlockedAt") FROM "UserAchievement" ua
            JOIN "Achievement" a ON a.id = ua."achievementId"
            WHERE ua."userId" = other."userId" AND a."gameId" = other."gameId"
          ) AS at
        FROM "UserGame" mine
        JOIN "UserGame" other ON other."gameId" = mine."gameId" AND other."unlockedCount" > 0
         AND other."userId" IN (${ids})
        WHERE mine."userId" = ${userId} AND mine.completion >= 100 AND NOT mine.hidden
          AND mine."lastUnlockedAt" IS NOT NULL
        ORDER BY mine."gameId", other."userId"
      ) started WHERE at > finished ORDER BY at ASC LIMIT ${FRIEND_SERIES.prescriber.at(-1)!}`,
    // Les jeux en commun avec l'ami qui en partage le plus : le compte monte à chaque jeu partagé.
    db.$queryRaw<FriendRow[]>`
      WITH best AS (
        SELECT other."userId" AS friend, count(*) AS shared
        FROM "UserGame" mine
        JOIN "UserGame" other ON other."gameId" = mine."gameId" AND other."userId" IN (${ids})
        WHERE mine."userId" = ${userId}
        GROUP BY other."userId"
        ORDER BY shared DESC, friend
        LIMIT 1
      )
      SELECT mine."gameId" AS id, best.friend AS friend
      FROM best
      JOIN "UserGame" mine ON mine."userId" = ${userId}
      JOIN "UserGame" other ON other."userId" = best.friend AND other."gameId" = mine."gameId"
      ORDER BY GREATEST(mine."lastPlayedAt", other."lastPlayedAt") ASC NULLS LAST
      LIMIT ${FRIEND_SERIES.same_taste.at(-1)!}`,
  ]);
  const entry = (kind: FriendProof['kind'], rows: FriendRow[]): FriendProof => ({
    kind,
    steps: rows.map((row) => ({ id: row.id, user: row.friend })),
  });
  return {
    counts: {
      duo: duo.length,
      revenge: revenge.length,
      teammates: teammates.length,
      synchro: synchro.length,
      prescriber: prescriber.length,
      same_taste: taste.length,
    },
    proofs: {
      duo: entry('games', duo),
      revenge: entry('games', revenge),
      teammates: entry('games', teammates),
      // Un jour en synchro se prouve par le succès débloqué ce jour-là.
      synchro: entry('achievements', synchro),
      prescriber: entry('games', prescriber),
      same_taste: entry('games', taste),
    },
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
      ...RARE_CARD,
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

export async function loadFacts(userId: string, earned: Set<string>): Promise<SiteFacts | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      timeZone: true,
      frame: true,
      showcaseCustom: true,
      clanMember: { select: { clanId: true, role: true } },
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
      orderBy: { createdAt: 'asc' },
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
    guide,
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
    // Le premier commentaire et le cinquantième suffisent : chaque palier montre le sien.
    db.comment.findMany({
      where: { authorId: userId, status: 'PUBLISHED' },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { achievementId: true },
    }),
    db.commentReaction.findMany({
      where: { comment: { authorId: userId, status: 'PUBLISHED' } },
      take: 10,
      select: { comment: { select: { achievementId: true } } },
    }),
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
      ? friendFacts(userId, friends)
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
    friendIds: friends,
    clan: clan && { owner: clan.role === 'OWNER', size: clanSize },
    clanId: clan?.clanId ?? null,
    messages,
    comments: comments.length,
    reactions: reactions.length,
    guideDone: Boolean(guide),
    guideAchievementId: guide ? guide.achievementId : null,
    commentAchievementIds: comments.map((row) => row.achievementId),
    reactionAchievementId: reactions[0]?.comment.achievementId ?? null,
    upheldReport: upheld > 0,
    doneFeedback: feedback > 0,
    season,
    soulmates,
    twins,
    perfectClan,
    firstEver,
    onlyOne,
    friendCounts: withFriends?.counts ?? NO_FRIEND_COUNTS,
    friendProofs: withFriends?.proofs,
    badInfluence: influence,
  };
}
