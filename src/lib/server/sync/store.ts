import type { Platform, TrophyType } from '#prisma';
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

/** Les petits lots respectent les limites mémoire et transactionnelles du NAS. */
const ACHIEVEMENTS_PER_TRANSACTION = 25;

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
  for (let offset = 0; offset < achievements.length; offset += ACHIEVEMENTS_PER_TRANSACTION) {
    const batch = achievements.slice(offset, offset + ACHIEVEMENTS_PER_TRANSACTION);
    const writes = batch.map((a) => {
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
    await db.$transaction(writes);
  }
  // Les upserts sont idempotents : une relance reprend un import interrompu par lots.
  await db.game.update({
    where: { id: gameId },
    data: { totalAchievements: achievements.length, schemaSyncedAt: new Date() },
  });
  await refreshGameTier(gameId);
}

/** Un succès qui vient de tomber : de quoi le montrer au joueur sans recharger sa page. */
export interface NewUnlock {
  id: string;
  name: string;
  iconUrl: string | null;
}

export interface SaveResult {
  /** Nombre de succès réellement ajoutés. */
  gained: number;
  /** Ceux qu'il vient d'obtenir : la page les fête en direct. */
  fresh: NewUnlock[];
}

/**
 * Enregistre les déverrouillages d'un joueur et recalcule sa progression.
 * Renvoie le nombre de succès nouvellement obtenus et de quoi les annoncer.
 */
export async function saveProgress(
  userId: string,
  gameId: string,
  unlocks: UnlockInput[],
  activity: { playtimeMinutes?: number; lastPlayedAt?: Date | null } = {},
): Promise<SaveResult> {
  const known = await db.achievement.findMany({
    where: { gameId },
    select: { id: true, platformAchievementId: true, trophyType: true, name: true, iconUrl: true },
  });
  const byPlatformId = new Map(known.map((a) => [a.platformAchievementId, a]));

  // L'état d'avant l'écriture : il dit à la fois ce qui est déjà acquis et ce qui est nouveau.
  const mine = await db.userAchievement.findMany({
    where: { userId, achievement: { gameId } },
    select: {
      achievementId: true,
      unlockedAt: true,
      achievement: { select: { trophyType: true } },
    },
  });
  const have = new Set(mine.map((row) => row.achievementId));

  // Une plateforme peut répéter un succès : une seule ligne par succès.
  const pending = new Map<
    string,
    {
      achievementId: string;
      unlockedAt: Date;
      trophyType: string;
      name: string;
      iconUrl: string | null;
    }
  >();
  for (const unlock of unlocks) {
    const achievement = byPlatformId.get(unlock.platformAchievementId);
    if (!achievement || have.has(achievement.id) || pending.has(achievement.id)) continue;
    pending.set(achievement.id, {
      achievementId: achievement.id,
      unlockedAt: unlock.unlockedAt,
      trophyType: achievement.trophyType,
      name: achievement.name,
      iconUrl: achievement.iconUrl,
    });
  }
  const rows = [...pending.values()].map(({ achievementId, unlockedAt }) => ({
    userId,
    achievementId,
    unlockedAt,
  }));
  // Une synchronisation parallèle a pu écrire les mêmes lignes entre-temps : seules celles
  // réellement insérées ici se fêtent, sans quoi le même succès s'afficherait deux fois.
  const inserted = await db.userAchievement.createManyAndReturn({
    data: rows,
    skipDuplicates: true,
    select: { achievementId: true },
  });
  const count = inserted.length;
  const ours = new Set(inserted.map((row) => row.achievementId));

  const total = known.length;
  // Insérées ici ou par l'autre synchronisation, toutes les lignes en attente existent désormais.
  const unlockedCount = mine.length + pending.size;
  const completion = total > 0 ? (unlockedCount / total) * 100 : 0;
  const platinum =
    mine.some((o) => o.achievement.trophyType === 'PLATINUM') ||
    [...pending.values()].some((o) => o.trophyType === 'PLATINUM');
  const lastUnlockedAt = [
    ...mine.map((o) => o.unlockedAt),
    ...pending.values().map((o) => o.unlockedAt),
  ].reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null);

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

  return {
    gained: count,
    fresh: [...pending.values()]
      .filter(({ achievementId }) => ours.has(achievementId))
      .map(({ achievementId, name, iconUrl }) => ({ id: achievementId, name, iconUrl })),
  };
}

/** Au-delà, un succès retrouvé à la visite suivante n'est plus une nouvelle. */
const CATCH_UP_DAYS = 7;

/**
 * Les derniers succès du joueur, pour les fêter quand il revient sur le site : ceux
 * débloqués pendant qu'il n'avait pas la page ouverte n'ont encore rien montré.
 */
export async function recentUnlocks(userId: string, limit = 3) {
  const since = new Date(Date.now() - CATCH_UP_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.userAchievement.findMany({
    where: { userId, unlockedAt: { gte: since } },
    orderBy: { unlockedAt: 'desc' },
    take: limit,
    select: {
      achievement: {
        select: { id: true, name: true, iconUrl: true, game: { select: { name: true } } },
      },
    },
  });
  return rows.map(({ achievement }) => ({
    id: achievement.id,
    title: achievement.name,
    icon: achievement.iconUrl,
    game: achievement.game.name,
  }));
}
