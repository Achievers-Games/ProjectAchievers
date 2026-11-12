import type { Prisma, Platform, TrophyType } from '#prisma';
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

async function availableSlug(
  db: Prisma.TransactionClient,
  name: string,
  platform: Platform,
  platformGameId: string,
) {
  const base = slugify(name) || 'jeu';
  const taken = await db.game.findUnique({ where: { slug: base }, select: { id: true } });
  if (!taken) return base;
  const suffix = `${base}-${platform.toLowerCase()}-${slugify(platformGameId)}`;
  let slug = suffix;
  for (
    let attempt = 2;
    await db.game.findUnique({ where: { slug }, select: { id: true } });
    attempt++
  ) {
    slug = `${suffix}-${attempt}`;
  }
  return slug;
}

export async function upsertGame(input: GameInput) {
  return db.$transaction(async (db) => {
    // Les créations sont courtes et partagent l'espace unique des slugs.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('game-catalog', 0))::text`;

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
        slug: await availableSlug(db, input.name, input.platform, input.platformGameId),
      },
    });
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
  /** Au plus cinq nouveaux succès : la page ne fête pas tout un premier import. */
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
  return db.$transaction(
    async (db) => {
      // Sérialise import complet et suivi en direct du même jeu pour ce joueur.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([userId, gameId])}, 0))::text`;

      let gained = 0;
      const freshIds: string[] = [];
      // La taille du SQL et des résultats Prisma reste bornée, même pour 8 000 succès WoW.
      const batchSize = 250;
      for (let offset = 0; offset < unlocks.length; offset += batchSize) {
        const batch = unlocks.slice(offset, offset + batchSize);
        const platformIds = batch.map((row) => row.platformAchievementId);
        const known = await db.$queryRaw<{ id: string; platformAchievementId: string }[]>`
          SELECT id, "platformAchievementId" FROM "Achievement"
          WHERE "gameId" = ${gameId} AND "platformAchievementId" = ANY(${platformIds}::text[])`;
        const byPlatformId = new Map(known.map((row) => [row.platformAchievementId, row]));
        const pending = new Map<string, Date>();
        for (const unlock of batch) {
          const achievement = byPlatformId.get(unlock.platformAchievementId);
          if (achievement && !pending.has(achievement.id))
            pending.set(achievement.id, unlock.unlockedAt);
        }
        if (!pending.size) continue;
        // Deux tableaux paramétrés évitent de construire un gros arbre de requête Prisma.
        const ids = [...pending.keys()];
        const dates = [...pending.values()].map((date) => date.toISOString());
        const inserted = await db.$queryRaw<{ achievementId: string }[]>`
          INSERT INTO "UserAchievement" ("userId", "achievementId", "unlockedAt")
          SELECT ${userId}, row.id, row.at
          FROM unnest(${ids}::text[], ${dates}::timestamp[]) AS row(id, at)
          ON CONFLICT ("userId", "achievementId") DO NOTHING
          RETURNING "achievementId"`;
        gained += inserted.length;
        for (const row of inserted.slice(0, 5 - freshIds.length)) freshIds.push(row.achievementId);
      }

      // Les agrégats restent dans Postgres : inutile de charger chaque succès déjà acquis.
      const [total, progress] = await Promise.all([
        db.achievement.count({ where: { gameId } }),
        db.$queryRaw<{ unlockedCount: number; lastUnlockedAt: Date | null; platinum: boolean }[]>`
          SELECT count(*)::int AS "unlockedCount", max(ua."unlockedAt") AS "lastUnlockedAt",
            coalesce(bool_or(a."trophyType" = 'PLATINUM'), false) AS platinum
          FROM "UserAchievement" ua
          JOIN "Achievement" a ON a.id = ua."achievementId"
          WHERE ua."userId" = ${userId} AND a."gameId" = ${gameId}`,
      ]);
      const { unlockedCount, lastUnlockedAt, platinum } = progress[0]!;
      const data = {
        unlockedCount,
        totalCount: total,
        completion: total > 0 ? (unlockedCount / total) * 100 : 0,
        platinum,
        lastUnlockedAt,
        ...(activity.playtimeMinutes !== undefined && {
          playtimeMinutes: activity.playtimeMinutes,
        }),
        ...(activity.lastPlayedAt !== undefined && { lastPlayedAt: activity.lastPlayedAt }),
      };
      await db.userGame.upsert({
        where: { userId_gameId: { userId, gameId } },
        update: data,
        create: { ...data, userId, gameId },
      });
      const fresh = freshIds.length
        ? await db.achievement.findMany({
            where: { id: { in: freshIds } },
            select: { id: true, name: true, iconUrl: true },
          })
        : [];
      return { gained, fresh };
    },
    { timeout: 30_000 },
  );
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
