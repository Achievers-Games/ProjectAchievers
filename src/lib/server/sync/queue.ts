import { PgBoss } from 'pg-boss';
import type { Provider } from '@prisma/client';
import { db } from '../db';
import { env } from '../env';
import { availableProviders } from '../providers';
import { SyncError } from './errors';
import { publishSync, publishUnlock } from './events';
import { syncPsn } from './psn';
import { syncSteam } from './steam';
import { syncXbox } from './xbox';
import type { ProviderSync } from './types';

const SYNC_QUEUE = 'sync-account';
const SWEEP_QUEUE = 'sync-sweep';
const STALE_AFTER = 24 * 60 * 60 * 1000;

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
    return instance;
  })());
}

export async function enqueueSync(userId: string, provider: Provider) {
  if (!SYNCERS[provider] || !availableProviders()[provider]) return false;

  const account = await db.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { syncStatus: true },
  });
  if (!account || account.syncStatus === 'QUEUED' || account.syncStatus === 'SYNCING') return false;

  await db.linkedAccount.update({
    where: { userId_provider: { userId, provider } },
    data: { syncStatus: 'QUEUED', syncError: null },
  });
  publishSync(userId, { provider, status: 'QUEUED', processed: 0, total: 0 });

  const job: SyncJob = { userId, provider };
  await (await boss()).send(SYNC_QUEUE, job, { retryLimit: 1, retryDelay: 60 });
  return true;
}

export async function runSync({ userId, provider }: SyncJob) {
  const syncer = SYNCERS[provider];
  if (!syncer) return;

  const where = { userId_provider: { userId, provider } };
  const account = await db.linkedAccount.findUnique({ where });
  if (!account) return;

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true, handle: true, avatarUrl: true, isPublic: true },
  });
  const run = await db.syncRun.create({ data: { userId, provider, status: 'SYNCING' } });
  await db.linkedAccount.update({ where, data: { syncStatus: 'SYNCING', syncError: null } });
  publishSync(userId, { provider, status: 'SYNCING', processed: 0, total: 0 });

  try {
    const result = await syncer({
      userId,
      account,
      report: (processed, total, game) =>
        publishSync(userId, { provider, status: 'SYNCING', processed, total, game }),
      onUnlocked: (game, count) => {
        if (!user.isPublic) return;
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
    publishSync(userId, {
      provider,
      status: 'COMPLETED',
      processed: result.games,
      total: result.games,
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

  await instance.work<SyncJob>(SYNC_QUEUE, { localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) await runSync(job.data);
  });
  await instance.work(SWEEP_QUEUE, async () => sweep());
  await instance.schedule(SWEEP_QUEUE, '0 * * * *');
}
