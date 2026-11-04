import type { Platform, Prisma, TrophyType } from '#prisma';
import { db } from '../db';
import { familyKey } from '../family';
import { difficultyTier } from '#lib/collection';
import { slugify } from '#lib/slug';

const POINTS: Record<TrophyType, number> = {
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
  console?: string | null;
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
  const fields = {
    name: input.name,
    coverUrl: input.coverUrl,
    headerUrl: input.headerUrl,
    console: input.console,
  };

  if (existing) {
    const family =
      existing.familyLocked || existing.familyMatched ? {} : { familyKey: familyKey(input.name) };
    return db.game.update({ where: { id: existing.id }, data: { ...fields, ...family } });
  }
  return db.game.create({
    data: {
      ...key,
      ...fields,
      familyKey: familyKey(input.name),
      slug: await availableSlug(input.name, input.platform, input.platformGameId),
    },
  });
}

/** Les jeux déjà connus sans console la reçoivent, même sans nouveau succès à lire. */
export async function fillConsoles(platform: Platform, consoles: Map<string, string | null>) {
  const missing = await db.game.findMany({
    where: { platform, console: null, platformGameId: { in: [...consoles.keys()] } },
    select: { id: true, platformGameId: true },
  });
  for (const game of missing) {
    const label = consoles.get(game.platformGameId);
    if (label) await db.game.update({ where: { id: game.id }, data: { console: label } });
  }
}

/** Un taux de 0 % veut dire « aucune donnée » : il ne compte pas comme une rareté. */
export async function refreshGameTier(gameId: string) {
  const [count, { _min }] = await Promise.all([
    db.achievement.count({ where: { gameId } }),
    db.achievement.aggregate({
      where: { gameId, globalRarity: { gt: 0 } },
      _min: { globalRarity: true },
    }),
  ]);
  await db.game.update({
    where: { id: gameId },
    data: { tier: difficultyTier(_min.globalRarity, count) },
  });
}

/** Rattrape les jeux déjà connus, une fois, au démarrage. */
export async function fillGameTiers() {
  const games = await db.game.findMany({ where: { tier: null }, select: { id: true } });
  for (const { id } of games) await refreshGameTier(id);
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
      // L'API ne décrit pas les succès cachés : ne pas effacer ce qui vient d'ailleurs.
      update: { ...data, description: a.description || undefined },
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
  await refreshGameTier(gameId);
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
  const platinum = owned.some((o) => o.achievement.trophyType === 'PLATINUM');
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
