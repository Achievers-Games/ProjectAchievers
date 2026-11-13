import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '#lib/logger';
import { m } from '#lib/paraglide/messages';
import { db } from './db';
import { env } from './env';
import { notify } from './push';

const log = logger('Sauvegarde');
const HOUR = 60 * 60 * 1000;
/** Une sauvegarde par jour : au-delà d'un jour et demi, la dernière a manqué. */
export const BACKUP_MAX_AGE = 36 * HOUR;
const DUMP = /^achievers-.*\.dump$/;

/** L'âge de la sauvegarde la plus récente, en millisecondes ; `null` s'il n'y en a aucune. */
export async function newestBackupAge(directory: string, now = Date.now()) {
  const names = (await readdir(directory)).filter((name) => DUMP.test(name));
  const times = await Promise.all(
    names.map(async (name) => (await stat(join(directory, name))).mtimeMs),
  );
  return times.length ? now - Math.max(...times) : null;
}

/**
 * Le conteneur de sauvegarde écrit ses fichiers sans rien dire à personne : un échec passait
 * inaperçu jusqu'au jour où il faut restaurer. Le site lit le dossier (monté en lecture seule)
 * et prévient les administrateurs, une fois par jour, tant que la dernière sauvegarde est trop
 * ancienne. Sans `BACKUP_DIR`, rien n'est surveillé.
 */
export async function warnStaleBackup(now = Date.now(), directory = env().BACKUP_DIR) {
  if (!directory) return false;
  const age = await newestBackupAge(directory, now).catch((cause) => {
    log.error('Dossier de sauvegarde illisible :', cause);
    return null;
  });
  if (age !== null && age <= BACKUP_MAX_AGE) return false;

  const hours = age === null ? null : Math.floor(age / HOUR);
  log.error(hours === null ? 'Aucune sauvegarde trouvée' : `Dernière sauvegarde : ${hours} h`);
  const key = `sauvegarde:${new Date(now).toISOString().slice(0, 10)}`;
  const { count } = await db.announcement.createMany({ data: [{ key }], skipDuplicates: true });
  if (count === 0) return true;
  const admins = await db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  for (const admin of admins) {
    notify(admin.id, 'digest', key, (locale) => ({
      title: m.mod_backup_late_title({}, { locale }),
      body:
        hours === null
          ? m.mod_backup_missing({}, { locale })
          : m.mod_backup_late({ hours }, { locale }),
      url: '/moderation',
    }));
  }
  return true;
}
