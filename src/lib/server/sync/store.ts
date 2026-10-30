import type { Platform, Prisma, TrophyType } from '@prisma/client';
import { db } from '../db';
import { slugify } from '$lib/slug';

export const POINTS: Record<TrophyType, number> = {
  PLATINUM: 180,
  GOLD: 90,
  SILVER: 30,
  BRONZE: 15,
  ACHIEVEMENT: 10,
};

export interface GameInput {
  platform: Platform;
  platformGameId: string;
  name: string;
  coverUrl?: string | null;
  headerUrl?: string | null;
}

export interface AchievementInput {
  platformAchievementId: string;
  name: string;
  description: string;
  iconUrl?: string | null;
  iconLockedUrl?: string | null;
  hidden: boolean;
  trophyType: TrophyType;
  globalRarity?: number | null;
  points?: number;
}

export interface UnlockInput {
  platformAchievementId: string;
  unlockedAt: Date;
}

async function availableSlug(name: string, platform: Platform, platformGameId: string) {
  const base = slugify(name) || 'jeu';
  const taken = await db.game.findUnique({ where: { slug: base }, select: { id: true } });
  return taken ? `${base}-${platform.toLowerCase()}-${slugify(platformGameId)}` : base;
}

export async function upsertGame(input: GameInput) {
  const key = { platform: input.platform, platformGameId: input.platformGameId };
  const existing = await db.game.findUnique({ where: { platform_platformGameId: key } });
  const fields = { name: input.name, coverUrl: input.coverUrl, headerUrl: input.headerUrl };

  if (existing) return db.game.update({ where: { id: existing.id }, data: fields });
  return db.game.create({
    data: {
      ...key,
      ...fields,
      slug: await availableSlug(input.name, input.platform, input.platformGameId),
    },
  });
}

/** Remplace le catalogue de succès d'un jeu. Les succès déjà connus gardent leur identifiant. */
export async function saveAchievements(gameId: string, achievements: AchievementInput[]) {
  const writes: Prisma.PrismaPromise<unknown>[] = achievements.map((a) => {
    const data = {
      name: a.name,
      description: a.description,
      iconUrl: a.iconUrl,
      iconLockedUrl: a.iconLockedUrl,
      hidden: a.hidden,
      trophyType: a.trophyType,
      globalRarity: a.globalRarity,
      points: a.points ?? POINTS[a.trophyType],
    };
    return db.achievement.upsert({
      where: {
        gameId_platformAchievementId: {
          gameId,
          platformAchievementId: a.platformAchievementId,
        },
      },
      update: data,
      create: { ...data, gameId, platformAchievementId: a.platformAchievementId },
    });
  });
  writes.push(
    db.game.update({
      where: { id: gameId },
      data: { totalAchievements: achievements.length, schemaSyncedAt: new Date() },
    }),
  );
  await db.$transaction(writes);
}

/**
 * Enregistre les déverrouillages d'un joueur et recalcule sa progression.
 * Renvoie le nombre de succès nouvellement obtenus.
 */
export async function saveProgress(
  userId: string,
  gameId: string,
  unlocks: UnlockInput[],
  activity: { playtimeMinutes?: number; lastPlayedAt?: Date | null } = {},
): Promise<number> {
  const known = await db.achievement.findMany({
    where: { gameId },
    select: { id: true, platformAchievementId: true, trophyType: true },
  });
  const byPlatformId = new Map(known.map((a) => [a.platformAchievementId, a]));

  const rows = unlocks.flatMap((unlock) => {
    const achievement = byPlatformId.get(unlock.platformAchievementId);
    return achievement
      ? [{ userId, achievementId: achievement.id, unlockedAt: unlock.unlockedAt }]
      : [];
  });

  const { count } = await db.userAchievement.createMany({ data: rows, skipDuplicates: true });

  const owned = await db.userAchievement.findMany({
    where: { userId, achievement: { gameId } },
    select: { unlockedAt: true, achievement: { select: { trophyType: true } } },
  });

  const total = known.length;
  const unlockedCount = owned.length;
  const completion = total > 0 ? (unlockedCount / total) * 100 : 0;
  const hasPlatinumTrophy = known.some((a) => a.trophyType === 'PLATINUM');
  const platinum = hasPlatinumTrophy
    ? owned.some((o) => o.achievement.trophyType === 'PLATINUM')
    : total > 0 && unlockedCount === total;
  const lastUnlockedAt = owned.reduce<Date | null>(
    (latest, o) => (!latest || o.unlockedAt > latest ? o.unlockedAt : latest),
    null,
  );

  const data = {
    unlockedCount,
    totalCount: total,
    completion,
    platinum,
    lastUnlockedAt,
    ...(activity.playtimeMinutes !== undefined && { playtimeMinutes: activity.playtimeMinutes }),
    ...(activity.lastPlayedAt !== undefined && { lastPlayedAt: activity.lastPlayedAt }),
  };
  await db.userGame.upsert({
    where: { userId_gameId: { userId, gameId } },
    update: data,
    create: { ...data, userId, gameId },
  });

  return count;
}
