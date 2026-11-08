import { createHmac, randomUUID } from 'node:crypto';
import { logger } from '#lib/logger';
import { decrypt, encrypt, randomToken } from './crypto';
import { db } from './db';
import { platformSlug } from './partner-api';

const log = logger('Webhooks partenaires');

/** Le nombre de succès qu'un envoi peut porter : au-delà, la suite part à l'envoi suivant. */
export const WEBHOOK_BATCH = 500;
/** Un partenaire lent ne doit pas bloquer la file : il retentera. */
const WEBHOOK_TIMEOUT = 10_000;
/** Laisse le temps aux transactions en cours de se terminer : rien n'arrive dans le passé. */
const SETTLE_MS = 5_000;
/** Une minute, puis deux, quatre… jusqu'à une heure entre deux essais après des échecs. */
const BACKOFF_BASE = 60_000;
const BACKOFF_MAX = 60 * 60_000;

/** Le secret ne s'affiche qu'à sa création ; il est gardé chiffré pour signer chaque envoi. */
export async function issueWebhookSecret(appId: string) {
  const secret = `whsec_${randomToken(24)}`;
  await db.partnerApp.update({
    where: { id: appId },
    data: { webhookSecret: encrypt(secret) },
  });
  return secret;
}

/**
 * La signature d'un envoi : `t=<horodatage>,v1=<HMAC-SHA256 de "t.corps">`. L'horodatage
 * signé empêche de rejouer un ancien envoi ; le partenaire refuse ce qui a plus de 5 minutes.
 */
export function signWebhook(secret: string, body: string, timestamp: number) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

const backoff = (failures: number) =>
  Math.min(BACKOFF_BASE * 2 ** Math.max(0, failures - 1), BACKOFF_MAX);

interface UnlockRow {
  createdAt: Date;
  unlockedAt: Date;
  userId: string;
  achievement: {
    platformAchievementId: string;
    name: string;
    game: {
      id: string;
      platform: Parameters<typeof platformSlug>[0];
      platformGameId: string;
      slug: string;
      name: string;
    };
  };
}

/**
 * Qui le partenaire suit : les joueurs reliés automatiquement (même identité OAuth) au profil
 * public, et ceux qui l'ont autorisé par « Se connecter avec Achievers » avec la portée
 * `library`, même au profil privé : ils ont dit oui en connaissance de cause.
 */
const followedBy = (app: { id: string; slug: string }) => ({
  OR: [
    { isPublic: true, partnerLinks: { some: { partner: app.slug, revokedAt: null } } },
    { oauthGrants: { some: { appId: app.id, revokedAt: null, scopes: { has: 'library' } } } },
  ],
});

/** Les succès arrivés après le curseur, pour les joueurs suivis, sur des jeux visibles. */
async function pendingUnlocks(app: { id: string; slug: string }, cursor: Date | null, until: Date) {
  const rows: UnlockRow[] = await db.userAchievement.findMany({
    where: {
      createdAt: { ...(cursor && { gt: cursor }), lte: until },
      user: followedBy(app),
      achievement: { game: { adultOnly: false } },
    },
    orderBy: { createdAt: 'asc' },
    take: WEBHOOK_BATCH,
    select: {
      createdAt: true,
      unlockedAt: true,
      userId: true,
      achievement: {
        select: {
          platformAchievementId: true,
          name: true,
          game: {
            select: { id: true, platform: true, platformGameId: true, slug: true, name: true },
          },
        },
      },
    },
  });
  // Un lot plein peut couper au milieu d'un même instant : ces lignes partiront au prochain envoi.
  if (rows.length === WEBHOOK_BATCH) {
    const last = rows.at(-1)!.createdAt.getTime();
    const cut = rows.filter((row) => row.createdAt.getTime() < last);
    if (cut.length > 0) return cut;
  }
  return rows;
}

/**
 * Un événement par joueur et par jeu : les succès débloqués, la progression qui en résulte, et
 * `game.completed` quand elle atteint 100 %. Un jeu masqué par le joueur ne part pas.
 */
async function buildEvents(slug: string, rows: UnlockRow[]) {
  // Un joueur autorisé par OAuth sans liaison n'a pas d'identifiant chez le partenaire : `id`
  // (Achievers, stable) suffit à le retrouver, puisque `/me` le donne aussi.
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const gameIds = [...new Set(rows.map((row) => row.achievement.game.id))];
  const [links, users, progress] = await Promise.all([
    db.partnerLink.findMany({
      where: { partner: slug, userId: { in: userIds }, revokedAt: null },
      select: { userId: true, partnerUserId: true },
    }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, handle: true } }),
    db.userGame.findMany({
      where: { userId: { in: userIds }, gameId: { in: gameIds } },
      select: {
        userId: true,
        gameId: true,
        hidden: true,
        unlockedCount: true,
        totalCount: true,
        completion: true,
      },
    }),
  ]);
  const partnerIds = new Map(links.map((link) => [link.userId, link.partnerUserId]));
  const handles = new Map(users.map((user) => [user.id, user.handle]));
  const progressOf = new Map(progress.map((row) => [`${row.userId}:${row.gameId}`, row]));

  const groups = Map.groupBy(rows, (row) => `${row.userId}:${row.achievement.game.id}`);
  return [...groups].flatMap(([key, unlocks]) => {
    const first = unlocks[0]!;
    const owned = progressOf.get(key);
    if (owned?.hidden) return [];
    const { game } = first.achievement;
    const completed = (owned?.completion ?? 0) >= 100;
    return [
      {
        id: randomUUID(),
        type: completed ? 'game.completed' : 'achievements.unlocked',
        user: {
          id: first.userId,
          handle: handles.get(first.userId) ?? null,
          partnerUserId: partnerIds.get(first.userId) ?? null,
        },
        game: {
          platform: platformSlug(game.platform),
          platformGameId: game.platformGameId,
          name: game.name,
        },
        achievements: unlocks.map((row) => ({
          id: row.achievement.platformAchievementId,
          name: row.achievement.name,
          unlockedAt: row.unlockedAt.toISOString(),
        })),
        progress: owned
          ? {
              unlocked: owned.unlockedCount,
              total: owned.totalCount,
              completion: Math.round(owned.completion * 10) / 10,
              completed,
            }
          : null,
      },
    ];
  });
}

/**
 * Un tour d'envoi pour chaque partenaire qui a une adresse de webhook. Au moins une fois : le
 * curseur n'avance qu'après une réponse 2xx, et un échec retente plus tard, avec une attente
 * qui double. Le partenaire se sert de l'`id` de chaque événement pour ignorer un doublon.
 */
export async function deliverPartnerWebhooks(now = new Date(), send: typeof fetch = fetch) {
  const apps = await db.partnerApp.findMany({
    where: {
      revokedAt: null,
      slug: { not: null },
      webhookUrl: { not: null },
      webhookSecret: { not: null },
    },
  });
  for (const app of apps) {
    if (
      app.webhookFailures > 0 &&
      app.webhookLastAttemptAt &&
      now.getTime() - app.webhookLastAttemptAt.getTime() < backoff(app.webhookFailures)
    ) {
      continue;
    }
    // Premier branchement : on part de maintenant, sans renvoyer tout l'historique.
    if (!app.webhookCursor) {
      await db.partnerApp.update({ where: { id: app.id }, data: { webhookCursor: now } });
      continue;
    }

    const until = new Date(now.getTime() - SETTLE_MS);
    const rows = await pendingUnlocks({ id: app.id, slug: app.slug! }, app.webhookCursor, until);
    if (rows.length === 0) continue;
    const cursor = rows.at(-1)!.createdAt;
    const events = await buildEvents(app.slug!, rows);
    if (events.length === 0) {
      await db.partnerApp.update({ where: { id: app.id }, data: { webhookCursor: cursor } });
      continue;
    }

    const body = JSON.stringify({ events });
    const timestamp = Math.floor(now.getTime() / 1000);
    let error: string | null = null;
    try {
      const response = await send(app.webhookUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Achievers-Webhooks/1',
          'X-Achievers-Signature': signWebhook(decrypt(app.webhookSecret!), body, timestamp),
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT),
      });
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    if (error) {
      log.warn(`${app.name} : ${error}`);
      await db.partnerApp.update({
        where: { id: app.id },
        data: {
          webhookFailures: { increment: 1 },
          webhookLastAttemptAt: now,
          webhookLastError: error.slice(0, 300),
        },
      });
    } else {
      await db.partnerApp.update({
        where: { id: app.id },
        data: {
          webhookCursor: cursor,
          webhookFailures: 0,
          webhookLastAttemptAt: now,
          webhookLastError: null,
        },
      });
    }
  }
}
