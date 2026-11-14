// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '#prisma';
import { db } from './db';
import { staleAccounts } from './sync/queue';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();

/** Un joueur et son compte PSN, avec éventuellement une synchronisation datée. */
async function account(
  name: string,
  syncStatus: SyncStatus,
  lastSyncedAt: Date | null,
  run?: Date,
) {
  const user = await db.user.create({
    data: { handle: `${PREFIX}-${name}-${Math.random()}`, displayName: `${PREFIX} ${name}` },
  });
  await db.linkedAccount.create({
    data: {
      userId: user.id,
      provider: 'PSN',
      providerUserId: `${PREFIX}-${Math.random()}`,
      displayName: name,
      syncStatus,
      lastSyncedAt,
    },
  });
  if (run) {
    await db.syncRun.create({
      data: { userId: user.id, provider: 'PSN', status: syncStatus, startedAt: run },
    });
  }
  return user.id;
}

describe('rattrapage des comptes en retard', () => {
  it('écarte les échecs du jour dès la requête et sert les plus en retard d’abord', async () => {
    const neverSynced = await account('jamais', 'IDLE', null);
    const oldest = await account('ancien', 'COMPLETED', new Date(now.getTime() - 10 * DAY));
    const older = await account('vieux', 'COMPLETED', new Date(now.getTime() - 2 * DAY));
    const fresh = await account('frais', 'COMPLETED', new Date(now.getTime() - 60_000));
    const failedToday = await account(
      'echec-du-jour',
      'FAILED',
      new Date(now.getTime() - 5 * DAY),
      new Date(now.getTime() - 60 * 60_000),
    );
    const failedLongAgo = await account(
      'echec-ancien',
      'FAILED',
      new Date(now.getTime() - 3 * DAY),
      new Date(now.getTime() - 3 * DAY),
    );
    const syncing = await account('en-cours', 'SYNCING', null);

    const ours = new Set([neverSynced, oldest, older, fresh, failedToday, failedLongAgo, syncing]);
    const order = (await staleAccounts(now, 10_000))
      .map((row) => row.userId)
      .filter((id) => ours.has(id));

    expect(order).toEqual([neverSynced, oldest, failedLongAgo, older]);
  });
});
