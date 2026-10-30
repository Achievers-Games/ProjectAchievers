import { PgBoss } from 'pg-boss';
import type { Provider } from '@prisma/client';
import { db } from '../db';
import { env } from '../env';
import { availableProviders } from '../providers';
import { RARE_CARD } from '../queries';
import type { Reward } from '$lib/collection';
import { rateGames } from './content';
import { SyncError } from './errors';
import { publishCard, publishSync, publishUnlock } from './events';
import { syncPsn } from './psn';
import { syncSteam } from './steam';
import { syncXbox } from './xbox';
import type { ProviderSync } from './types';

const SYNC_QUEUE = 'sync-account';
const SWEEP_QUEUE = 'sync-sweep';
const CONTENT_QUEUE = 'content-rating';
const STALE_AFTER = 24 * 60 * 60 * 1000;
const MAX_REWARDS = 10;
/** Au-delà, la carte est ancienne : lier un compte ne doit pas inonder le fil en direct. */
const LIVE_CARD_MAX_AGE = 48 * 60 * 60 * 1000;

const SYNCERS: Partial<Record<Provider, ProviderSync>> = {
  STEAM: syncSteam,
  PSN: syncPsn,
  XBOX: syncXbox,
};

interface SyncJob {
  userId: string;
  provider: Provider;
}

const globalForBoss = globalThis as unknown as { paBoss?: Promise<PgBoss> };

function boss(): Promise<PgBoss> {
  return (globalForBoss.paBoss ??= (async () => {
    const instance = new PgBoss(env().DATABASE_URL);
    instance.on('error', (error) => console.error('pg-boss :', error));
    await instance.start();
    await instance.createQueue(SYNC_QUEUE);
    await instance.createQueue(SWEEP_QUEUE);
    await instance.createQueue(CONTENT_QUEUE);
    return instance;
  })());
}

export async function enqueueSync(userId: string, provider: Provider) {
  if (!SYNCERS[provider] || !availableProviders()[provider]) return false;

  // Une seule requête : deux clics simultanés ne peuvent pas lancer deux synchronisations.
  const { count } = await db.linkedAccount.updateMany({
    where: { userId, provider, syncStatus: { notIn: ['QUEUED', 'SYNCING'] } },
    data: { syncStatus: 'QUEUED', syncError: null },
  });
  if (count === 0) return false;

  publishSync(userId, { provider, status: 'QUEUED', processed: 0, total: 0 });

  const job: SyncJob = { userId, provider };
  await (await boss()).send(SYNC_QUEUE, job, { retryLimit: 1, retryDelay: 60 });
  return true;
}

async function rareCards(userId: string) {
  const rows = await db.userGame.findMany({
    where: { userId, ...RARE_CARD },
    select: {
      gameId: true,
      unlockedCount: true,
      completion: true,
      platinum: true,
      lastUnlockedAt: true,
      game: {
        select: {
          name: true,
          slug: true,
          platform: true,
          headerUrl: true,
          totalAchievements: true,
          adultOnly: true,
        },
      },
    },
  });
  return new Map(
    rows.map(({ gameId, game, lastUnlockedAt, ...progress }): [string, Reward] => [
      gameId,
      { game, progress, unlockedAt: lastUnlockedAt },
    ]),
  );
}

/** Cartes apparues depuis `before`. */
function newRewards(before: Map<string, Reward>, after: Map<string, Reward>) {
  return [...after].filter(([id]) => !before.has(id)).map(([, card]) => card);
}

export async function runSync({ userId, provider }: SyncJob) {
  const syncer = SYNCERS[provider];
  if (!syncer) return;

  const where = { userId_provider: { userId, provider } };
  const account = await db.linkedAccount.findUnique({ where });
  if (!account) return;

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true, handle: true, avatarUrl: true, isPublic: true, showAdult: true },
  });
  const run = await db.syncRun.create({ data: { userId, provider, status: 'SYNCING' } });
  await db.linkedAccount.update({ where, data: { syncStatus: 'SYNCING', syncError: null } });
  publishSync(userId, { provider, status: 'SYNCING', processed: 0, total: 0 });

  try {
    const before = await rareCards(userId);
    const result = await syncer({
      userId,
      account,
      report: (processed, total, game) =>
        publishSync(userId, { provider, status: 'SYNCING', processed, total, game }),
      onUnlocked: (game, count) => {
        if (!user.isPublic || game.adultOnly) return;
        publishUnlock({
          user: user.displayName,
          handle: user.handle,
          avatarUrl: user.avatarUrl,
          game: game.name,
          gameSlug: game.slug,
          count,
        });
      },
    });

    const finishedAt = new Date();
    await db.$transaction([
      db.syncRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', ...result, finishedAt },
      }),
      db.linkedAccount.update({
        where,
        data: { syncStatus: 'COMPLETED', lastSyncedAt: finishedAt },
      }),
    ]);
    const rewards = newRewards(before, await rareCards(userId)).filter(
      ({ game }) => user.showAdult || !game.adultOnly,
    );
    if (user.isPublic) {
      const { displayName, handle, avatarUrl } = user;
      for (const { game, unlockedAt } of rewards) {
        const recent = unlockedAt && Date.now() - unlockedAt.getTime() < LIVE_CARD_MAX_AGE;
        if (unlockedAt && recent && !game.adultOnly) {
          publishCard({ user: { displayName, handle, avatarUrl }, game, unlockedAt });
        }
      }
    }
    publishSync(userId, {
      provider,
      status: 'COMPLETED',
      processed: result.games,
      total: result.games,
      achievements: result.achievements,
      rewards: rewards.slice(0, MAX_REWARDS),
      moreRewards: Math.max(0, rewards.length - MAX_REWARDS),
    });
  } catch (error) {
    const known = error instanceof SyncError;
    if (!known) console.error(`Synchronisation ${provider} :`, error);
    const message = known ? error.message : 'La synchronisation a échoué. Réessaie plus tard.';
    const status = known && error.needsRelink ? 'NEEDS_RELINK' : 'FAILED';

    await db.$transaction([
      db.syncRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      }),
      db.linkedAccount.update({ where, data: { syncStatus: status, syncError: message } }),
    ]);
    publishSync(userId, { provider, status, processed: 0, total: 0, error: message });
  }
}

async function sweep() {
  const now = new Date();
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.psnVerification.deleteMany({ where: { expiresAt: { lt: now } } });

  const accounts = await db.linkedAccount.findMany({
    where: {
      provider: { in: ['STEAM', 'PSN', 'XBOX'] },
      syncStatus: { in: ['IDLE', 'COMPLETED', 'FAILED'] },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - STALE_AFTER) } }],
    },
    select: { userId: true, provider: true },
    take: 500,
  });
  for (const account of accounts) await enqueueSync(account.userId, account.provider);
}

/** Démarre le traitement des synchronisations dans le processus du site. */
export async function startWorkers() {
  const instance = await boss();

  // Un arrêt brutal peut laisser des comptes bloqués en cours de synchronisation.
  await db.linkedAccount.updateMany({
    where: { syncStatus: { in: ['QUEUED', 'SYNCING'] } },
    data: { syncStatus: 'IDLE' },
  });

  await instance.work<SyncJob>(
    SYNC_QUEUE,
    { localConcurrency: env().SYNC_CONCURRENCY },
    async (jobs) => {
      for (const job of jobs) await runSync(job.data);
    },
  );
  await instance.work(SWEEP_QUEUE, async () => sweep());
  await instance.schedule(SWEEP_QUEUE, '0 * * * *');
  await instance.work(CONTENT_QUEUE, async () => void (await rateGames()));
  await instance.schedule(CONTENT_QUEUE, '*/5 * * * *');
}
