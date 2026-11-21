import { Prisma, type ActivityEmoji } from '#prisma';
import type { ActivityReactions } from '#lib/activity';
import { commentLimit } from '#lib/comments';
import { loadComments } from './comments';
import { db } from './db';
import { publicGames, publicUser, visibleGames } from './queries/shared';
import { friendIds, relationWith } from './social/friends';
import { canTranslate } from './translate';

type Viewer = Pick<NonNullable<App.Locals['user']>, 'id' | 'showAdult'>;

const unblocked = (id: string) => ({
  blocks: { none: { blockedId: id } },
  blockedBy: { none: { blockerId: id } },
});

const achievement = {
  id: true,
  name: true,
  hidden: true,
  iconUrl: true,
  globalRarity: true,
  gameId: true,
  game: { select: { name: true, slug: true } },
} as const;

export async function friendUnlocks(viewer: Viewer) {
  const friends = await friendIds(viewer.id);
  if (!friends.length) return [];
  const keys = await db.$queryRaw<{ userId: string; achievementId: string }[]>`
    SELECT ua."userId", ua."achievementId"
    FROM "UserAchievement" ua
    JOIN "User" u ON u.id = ua."userId" AND u."isPublic"
    JOIN "Achievement" a ON a.id = ua."achievementId"
    JOIN "Game" g ON g.id = a."gameId"
    JOIN "UserGame" ug ON ug."userId" = ua."userId" AND ug."gameId" = a."gameId"
    WHERE ua."userId" IN (${Prisma.join(friends)}) AND NOT ug.hidden
      AND (${viewer.showAdult} OR NOT g."adultOnly")
      AND NOT EXISTS (
        SELECT 1 FROM "Block" b
        WHERE (b."blockerId" = ua."userId" AND b."blockedId" = ${viewer.id})
           OR (b."blockedId" = ua."userId" AND b."blockerId" = ${viewer.id})
      )
    ORDER BY ua."unlockedAt" DESC, ua."userId", ua."achievementId"
    LIMIT 20
  `;
  if (!keys.length) return [];
  const rows = await db.userAchievement.findMany({
    where: {
      OR: keys,
      user: { isPublic: true, ...unblocked(viewer.id) },
      achievement: { game: visibleGames(viewer.showAdult) },
    },
    orderBy: [{ unlockedAt: 'desc' }, { userId: 'asc' }, { achievementId: 'asc' }],
    select: {
      userId: true,
      unlockedAt: true,
      user: { select: publicUser },
      achievement: { select: achievement },
      _count: {
        select: {
          discussion: { where: { status: 'PUBLISHED', author: unblocked(viewer.id) } },
        },
      },
    },
  });
  if (!rows.length) return [];
  const known = await db.userAchievement.findMany({
    where: {
      userId: viewer.id,
      achievementId: {
        in: rows.filter((row) => row.achievement.hidden).map((row) => row.achievement.id),
      },
    },
    select: { achievementId: true },
  });
  const visibleAchievements = new Set(known.map(({ achievementId }) => achievementId));
  // Les réactions de toute la rangée en une requête, regroupées par déblocage.
  const reactions = await db.unlockReaction.findMany({
    where: { OR: rows.map((row) => ({ ownerId: row.userId, achievementId: row.achievement.id })) },
  });
  const byUnlock = Map.groupBy(reactions, (row) => `${row.ownerId}/${row.achievementId}`);
  return rows.map(({ achievement: item, user, userId, unlockedAt, _count }) => {
    const masked = item.hidden && !visibleAchievements.has(item.id);
    return {
      user,
      unlockedAt,
      count: _count.discussion,
      game: item.game,
      achievementId: item.id,
      name: masked ? null : item.name,
      iconUrl: masked ? null : item.iconUrl,
      rarity: item.globalRarity,
      reactions: summarize(byUnlock.get(`${userId}/${item.id}`) ?? [], viewer.id),
    };
  });
}

export async function unlockThreadFor(
  viewer: Viewer | null,
  handle: string,
  achievementId: string,
) {
  if (!viewer) return null;
  const row = await db.userAchievement.findFirst({
    where: {
      achievementId,
      user: { handle, OR: [{ isPublic: true }, { id: viewer.id }] },
      achievement: { game: visibleGames(viewer.showAdult) },
    },
    select: {
      userId: true,
      unlockedAt: true,
      user: { select: publicUser },
      achievement: { select: achievement },
    },
  });
  if (!row) return null;
  const [relation, progress] = await Promise.all([
    relationWith(viewer.id, row.userId),
    db.userGame.findUnique({
      where: { userId_gameId: { userId: row.userId, gameId: row.achievement.gameId } },
      select: { hidden: true },
    }),
  ]);
  if (!progress || (relation !== 'self' && (relation !== 'friends' || progress.hidden)))
    return null;
  return row;
}

export async function cardReactionTarget(viewer: Viewer, handle: string, slug: string) {
  return db.userGame.findFirst({
    where: {
      completion: { gte: 100 },
      hidden: false,
      lastUnlockedAt: { not: null },
      user: { handle, isPublic: true, ...unblocked(viewer.id) },
      game: { slug, ...(viewer.showAdult ? {} : publicGames) },
    },
    select: { gameId: true, userId: true },
  });
}

function summarize(
  rows: { userId: string; emoji: ActivityEmoji }[],
  viewerId: string | undefined,
): ActivityReactions {
  const counts: ActivityReactions['counts'] = {};
  let mine: ActivityEmoji | null = null;
  for (const { emoji, userId } of rows) {
    counts[emoji] = (counts[emoji] ?? 0) + 1;
    if (userId === viewerId) mine = emoji;
  }
  return { counts, mine };
}

export async function liveReactions(
  cards: { ownerId: string; gameId: string }[],
  viewerId?: string,
) {
  if (!cards.length) return new Map<string, ActivityReactions>();
  const [rows, mine] = await Promise.all([
    db.liveReaction.groupBy({
      by: ['ownerId', 'gameId', 'emoji'],
      where: { OR: cards },
      _count: true,
    }),
    viewerId ? db.liveReaction.findMany({ where: { userId: viewerId, OR: cards } }) : [],
  ]);
  const summaries = new Map<string, ActivityReactions>();
  const forCard = (ownerId: string, gameId: string) => {
    const key = `${ownerId}/${gameId}`;
    const summary = summaries.get(key) ?? { counts: {}, mine: null };
    summaries.set(key, summary);
    return summary;
  };
  for (const row of rows) forCard(row.ownerId, row.gameId).counts[row.emoji] = row._count;
  for (const row of mine) forCard(row.ownerId, row.gameId).mine = row.emoji;
  return summaries;
}

export async function unlockReactions(ownerId: string, achievementId: string, viewerId: string) {
  const rows = await db.unlockReaction.findMany({ where: { ownerId, achievementId } });
  return summarize(rows, viewerId);
}

export async function loadUnlockDiscussion(
  viewer: NonNullable<App.Locals['user']>,
  row: NonNullable<Awaited<ReturnType<typeof unlockThreadFor>>>,
  url: URL,
) {
  const target = { unlockOwnerId: row.userId, unlockAchievementId: row.achievement.id };
  const [comments, reactions, known] = await Promise.all([
    loadComments(target, viewer, commentLimit(url)),
    unlockReactions(row.userId, row.achievement.id, viewer.id),
    row.achievement.hidden &&
      viewer.id !== row.userId &&
      db.userAchievement.count({
        where: { userId: viewer.id, achievementId: row.achievement.id },
      }),
  ]);
  const masked = row.achievement.hidden && viewer.id !== row.userId && !known;
  return {
    user: row.user,
    unlockedAt: row.unlockedAt,
    game: row.achievement.game,
    achievementId: row.achievement.id,
    name: masked ? null : row.achievement.name,
    iconUrl: masked ? null : row.achievement.iconUrl,
    globalRarity: row.achievement.globalRarity,
    comments,
    reactions,
    canTranslate: canTranslate(),
  };
}
