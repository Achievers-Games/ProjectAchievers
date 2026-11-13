import { createHash, createHmac } from 'node:crypto';
import { logger } from '#lib/logger';
import { decrypt, encrypt, randomToken } from './crypto';
import { db } from './db';
import { apiAvatar, apiCard, platformSlug, steamAppIds } from './partner-api';

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
  achievementId: string;
  createdAt: Date;
  unlockedAt: Date;
  userId: string;
  achievement: {
    platformAchievementId: string;
    name: string;
    globalRarity: number | null;
    game: {
      id: string;
      platform: Parameters<typeof platformSlug>[0];
      platformGameId: string;
      slug: string;
      name: string;
      tier: number | null;
      familyKey: string | null;
    };
  };
}

/** Sous ce pourcentage de joueurs, un succès vaut un événement à lui seul : achievement.rare. */
const RARE_ACHIEVEMENT = 1;

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
type UnlockCursor = { at: Date; userId: string | null; achievementId: string | null };

async function pendingUnlocks(
  app: { id: string; slug: string },
  cursor: UnlockCursor,
  until: Date,
) {
  const rows: UnlockRow[] = await db.userAchievement.findMany({
    where: {
      createdAt: { lte: until },
      OR: [
        { createdAt: { gt: cursor.at } },
        ...(cursor.userId && cursor.achievementId
          ? [
              { createdAt: cursor.at, userId: { gt: cursor.userId } },
              {
                createdAt: cursor.at,
                userId: cursor.userId,
                achievementId: { gt: cursor.achievementId },
              },
            ]
          : []),
      ],
      user: followedBy(app),
      achievement: { game: { adultOnly: false } },
    },
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }, { achievementId: 'asc' }],
    take: WEBHOOK_BATCH,
    select: {
      createdAt: true,
      achievementId: true,
      unlockedAt: true,
      userId: true,
      achievement: {
        select: {
          platformAchievementId: true,
          name: true,
          globalRarity: true,
          game: {
            select: {
              id: true,
              platform: true,
              platformGameId: true,
              slug: true,
              name: true,
              tier: true,
              familyKey: true,
            },
          },
        },
      },
    },
  });
  return rows;
}

/**
 * Un événement par joueur et par jeu : les succès débloqués, la progression qui en résulte, et
 * `game.completed` quand elle atteint 100 %. Un jeu masqué par le joueur ne part pas.
 */
type WebhookUser = {
  id: string;
  handle: string;
  isPublic: boolean;
  avatarUrl: string | null;
  partnerUserId: string | null;
};

/** Les joueurs tels que les webhooks les décrivent, avec leur compte chez ce partenaire. */
async function webhookUsers(slug: string, userIds: string[]) {
  const [links, users] = await Promise.all([
    db.partnerLink.findMany({
      where: { partner: slug, userId: { in: userIds }, revokedAt: null },
      select: { userId: true, partnerUserId: true },
    }),
    db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, handle: true, isPublic: true, avatarUrl: true },
    }),
  ]);
  const partnerIds = new Map(links.map((link) => [link.userId, link.partnerUserId]));
  return new Map(
    users.map((user): [string, WebhookUser] => [
      user.id,
      {
        id: user.id,
        handle: user.handle,
        isPublic: user.isPublic,
        avatarUrl: apiAvatar(user.avatarUrl),
        partnerUserId: partnerIds.get(user.id) ?? null,
      },
    ]),
  );
}

/**
 * Un identifiant d'événement stable : le même lot renvoyé après un échec garde les mêmes `id`,
 * et le partenaire peut ignorer ce qu'il a déjà traité.
 */
const stableId = (key: string) => {
  const hex = createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

async function buildEvents(slug: string, rows: UnlockRow[]) {
  // Un joueur autorisé par OAuth sans liaison n'a pas d'identifiant chez le partenaire : `id`
  // (Achievers, stable) suffit à le retrouver, puisque `/me` le donne aussi.
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const gameIds = [...new Set(rows.map((row) => row.achievement.game.id))];
  const [users, progress, steamIds] = await Promise.all([
    webhookUsers(slug, userIds),
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
    steamAppIds(rows.map((row) => row.achievement.game)),
  ]);
  const progressOf = new Map(progress.map((row) => [`${row.userId}:${row.gameId}`, row]));

  const groups = Map.groupBy(rows, (row) => `${row.userId}:${row.achievement.game.id}`);
  return [...groups].flatMap(([key, unlocks]) => {
    const first = unlocks[0]!;
    const owned = progressOf.get(key);
    const user = users.get(first.userId);
    if (owned?.hidden || !user) return [];
    const { game } = first.achievement;
    const completed = (owned?.completion ?? 0) >= 100;
    const ids = unlocks.map((row) => row.achievement.platformAchievementId).sort();
    const at = unlocks.at(-1)!.createdAt.toISOString();
    const gameView = {
      platform: platformSlug(game.platform),
      platformGameId: game.platformGameId,
      name: game.name,
      // L'appid Steam du même jeu, pour un 100 % sur PS5 ou Xbox : les fiches Lure en dépendent.
      steamAppId:
        game.platform === 'STEAM'
          ? game.platformGameId
          : game.familyKey
            ? (steamIds.get(game.familyKey) ?? null)
            : null,
    };
    // Un succès très rare vaut une annonce à lui seul, en plus du lot.
    const rare = unlocks
      .filter((row) => (row.achievement.globalRarity ?? 100) < RARE_ACHIEVEMENT)
      .map((row) => ({
        id: stableId(`${key}:rare:${row.achievement.platformAchievementId}`),
        type: 'achievement.rare',
        at: row.createdAt.toISOString(),
        user,
        game: gameView,
        achievement: {
          id: row.achievement.platformAchievementId,
          name: row.achievement.name,
          rarity: row.achievement.globalRarity,
          unlockedAt: row.unlockedAt.toISOString(),
        },
      }));
    const card = completed
      ? [
          {
            id: stableId(`${key}:card`),
            type: 'card.earned',
            at,
            user,
            game: gameView,
            card: apiCard(game.tier),
          },
        ]
      : [];
    return [
      {
        id: stableId(`${key}:${ids.join(',')}`),
        type: completed ? 'game.completed' : 'achievements.unlocked',
        at,
        user,
        game: gameView,
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
      ...card,
      ...rare,
    ];
  });
}

type AccountEventType = 'user.linked' | 'user.unlinked' | 'user.updated' | 'user.deleted';

/**
 * Note qu'un partenaire doit apprendre un changement de compte. `linked` et `unlinked` visent
 * un partenaire précis ; `updated` (handle, avatar, profil public ou privé) va à chaque
 * partenaire qui suit le joueur. Rien n'est noté pour un partenaire sans webhook.
 */
export async function queueAccountEvent(
  userId: string,
  type: AccountEventType,
  options: {
    app?: { slug: string } | { id: string };
    via?: 'AUTO' | 'OAUTH';
    partnerUserId?: string | null;
  } = {},
) {
  const withWebhook = { revokedAt: null, webhookUrl: { not: null } };
  const apps = options.app
    ? await db.partnerApp.findMany({ where: { ...withWebhook, ...options.app } })
    : await db.partnerApp.findMany({
        where: {
          ...withWebhook,
          OR: [
            { oauthGrants: { some: { userId, revokedAt: null } } },
            {
              slug: {
                in: (
                  await db.partnerLink.findMany({
                    where: { userId, revokedAt: null },
                    select: { partner: true },
                  })
                ).map((link) => link.partner),
              },
            },
          ],
        },
      });

  for (const app of apps) {
    // Un seul `updated` en attente par joueur suffit : l'envoi décrit toujours l'état actuel.
    if (type === 'user.updated') {
      const pending = await db.partnerEvent.count({
        where: { appId: app.id, userId, type, deliveredAt: null },
      });
      if (pending) continue;
    }
    await db.partnerEvent.create({
      data: {
        appId: app.id,
        userId,
        type,
        via: options.via ?? null,
        partnerUserId: options.partnerUserId ?? null,
      },
    });
  }
}

/**
 * À appeler juste avant de supprimer un compte : chaque partenaire qui le suivait apprendra
 * qu'il doit effacer ce qu'il en garde. L'événement porte l'identifiant du joueur et son compte
 * chez le partenaire, puisque plus rien d'autre n'existera au moment de l'envoi.
 */
export async function queueAccountDeletion(userId: string) {
  const links = await db.partnerLink.findMany({
    where: { userId, revokedAt: null },
    select: { partner: true, partnerUserId: true },
  });
  const partnerIds = new Map(links.map((link) => [link.partner, link.partnerUserId]));
  const apps = await db.partnerApp.findMany({
    where: {
      revokedAt: null,
      webhookUrl: { not: null },
      OR: [
        { oauthGrants: { some: { userId, revokedAt: null } } },
        { slug: { in: [...partnerIds.keys()] } },
      ],
    },
    select: { id: true, slug: true },
  });
  if (!apps.length) return;
  await db.partnerEvent.createMany({
    data: apps.map((app) => ({
      appId: app.id,
      userId,
      subjectId: userId,
      type: 'user.deleted',
      partnerUserId: (app.slug && partnerIds.get(app.slug)) || null,
    })),
  });
}

/** Les événements de compte encore à envoyer, décrits avec l'état actuel du joueur. */
async function pendingAccountEvents(app: { id: string; slug: string }) {
  const rows = await db.partnerEvent.findMany({
    where: { appId: app.id, deliveredAt: null },
    orderBy: { createdAt: 'asc' },
    take: WEBHOOK_BATCH,
  });
  const users = await webhookUsers(app.slug, [...new Set(rows.flatMap((row) => row.userId ?? []))]);
  const events = rows.flatMap((row) => {
    if (row.type === 'user.deleted') {
      // Le compte n'existe plus : seuls ses identifiants restent à transmettre.
      return row.subjectId
        ? [
            {
              id: row.id,
              type: row.type,
              at: row.createdAt.toISOString(),
              user: { id: row.subjectId, partnerUserId: row.partnerUserId },
            },
          ]
        : [];
    }
    // Un événement plus ancien d'un compte supprimé depuis n'a plus rien à décrire.
    const user = row.userId ? users.get(row.userId) : undefined;
    if (!user) return [];
    return [
      {
        id: row.id,
        type: row.type,
        at: row.createdAt.toISOString(),
        ...(row.via && { via: row.via.toLowerCase() }),
        // Délié : le lien n'existe plus, c'est le compte d'alors qui compte.
        user: { ...user, partnerUserId: row.partnerUserId ?? user.partnerUserId },
      },
    ];
  });
  return { ids: rows.map((row) => row.id), events };
}

/**
 * Un tour d'envoi pour chaque partenaire qui a une adresse de webhook. Au moins une fois : rien
 * n'est marqué envoyé avant une réponse 2xx, et un échec retente plus tard, avec une attente
 * qui double. Le partenaire se sert de l'`id` de chaque événement, stable d'un essai à
 * l'autre, pour ignorer un doublon.
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
    const target = { id: app.id, slug: app.slug! };
    const account = await pendingAccountEvents(target);

    // Premier branchement : les succès partent de maintenant, sans renvoyer l'historique.
    let cursor = app.webhookCursor;
    let cursorUserId = app.webhookCursorUserId;
    let cursorAchievementId = app.webhookCursorAchievementId;
    let unlocks: Awaited<ReturnType<typeof buildEvents>> = [];
    if (!cursor) {
      await db.partnerApp.update({
        where: { id: app.id },
        data: { webhookCursor: now, webhookCursorUserId: null, webhookCursorAchievementId: null },
      });
    } else {
      const until = new Date(now.getTime() - SETTLE_MS);
      const rows = await pendingUnlocks(
        target,
        { at: cursor, userId: cursorUserId, achievementId: cursorAchievementId },
        until,
      );
      if (rows.length > 0) {
        cursor = rows.at(-1)!.createdAt;
        cursorUserId = rows.at(-1)!.userId;
        cursorAchievementId = rows.at(-1)!.achievementId;
        unlocks = await buildEvents(app.slug!, rows);
        if (unlocks.length === 0 && account.events.length === 0) {
          await db.partnerApp.update({
            where: { id: app.id },
            data: {
              webhookCursor: cursor,
              webhookCursorUserId: cursorUserId,
              webhookCursorAchievementId: cursorAchievementId,
            },
          });
          continue;
        }
      }
    }

    const events = [...account.events, ...unlocks];
    if (events.length === 0) continue;

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
      await db.$transaction([
        db.partnerEvent.updateMany({
          where: { id: { in: account.ids } },
          data: { deliveredAt: now },
        }),
        db.partnerApp.update({
          where: { id: app.id },
          data: {
            ...(cursor && { webhookCursor: cursor }),
            webhookCursorUserId: cursorUserId,
            webhookCursorAchievementId: cursorAchievementId,
            webhookFailures: 0,
            webhookLastAttemptAt: now,
            webhookLastError: null,
          },
        }),
      ]);
    }
  }
}
