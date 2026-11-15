import { describe, expect, it } from 'vitest';
import { latestSyncError, type SyncProgress } from './sync';

const event = (status: SyncProgress['status'], error?: string | null) =>
  ({ provider: 'STEAM', status, processed: 0, total: 0, error }) as SyncProgress;

describe('latestSyncError', () => {
  it('efface l’échec enregistré dès que la synchronisation repart', () => {
    expect(latestSyncError(event('QUEUED'), 'sync_steam_private')).toBeNull();
    expect(latestSyncError(event('SYNCING'), 'sync_steam_private')).toBeNull();
  });

  it('garde l’échec du direct, puis celui de la page à défaut', () => {
    expect(latestSyncError(event('FAILED', 'sync_failed_retry'), null)).toBe('sync_failed_retry');
    expect(latestSyncError(undefined, 'sync_steam_private')).toBe('sync_steam_private');
  });
});
