import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUP_MAX_AGE, newestBackupAge } from './backup-watch';

const HOUR = 60 * 60 * 1000;
let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function backups(ages: Record<string, number>, now: number) {
  directory = await mkdtemp(join(tmpdir(), 'pa-sauvegardes-'));
  for (const [name, age] of Object.entries(ages)) {
    const file = join(directory, name);
    await writeFile(file, '');
    const at = new Date(now - age);
    await utimes(file, at, at);
  }
  return directory;
}

describe('surveillance des sauvegardes', () => {
  it('ne retient que les sauvegardes terminées, et prend la plus récente', async () => {
    const now = Date.now();
    const dir = await backups(
      {
        'achievers-2026-11-10.dump': 50 * HOUR,
        'achievers-2026-11-12.dump': 3 * HOUR,
        // Un fichier en cours d'écriture ou étranger ne prouve aucune sauvegarde.
        'achievers-2026-11-13.dump.tmp': 0,
        'notes.txt': 0,
      },
      now,
    );
    const age = await newestBackupAge(dir, now);
    expect(Math.round((age ?? 0) / HOUR)).toBe(3);
    expect(age).toBeLessThan(BACKUP_MAX_AGE);
  });

  it('signale un dossier sans aucune sauvegarde', async () => {
    const now = Date.now();
    expect(await newestBackupAge(await backups({ 'notes.txt': 0 }, now), now)).toBeNull();
  });
});
