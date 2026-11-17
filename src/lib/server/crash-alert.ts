import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '#lib/logger';
import { db } from './db';
import { inbox, inboxReady, sendMail } from './email';

const log = logger('Serveur');

/**
 * Témoin d'un serveur en marche. Docker relance un conteneur planté avec ses fichiers, mais un
 * déploiement en crée un neuf : un témoin encore présent au démarrage veut dire que le processus
 * d'avant est mort sans s'arrêter proprement (mémoire épuisée, plantage).
 */
const MARKER = join(tmpdir(), 'project-achievers.running');

/** Pose le témoin, et renvoie l'heure de démarrage du processus mort brutalement, s'il y en a un. */
export function markRunning(now = new Date()): string | null {
  let previous: string | null = null;
  try {
    previous = readFileSync(MARKER, 'utf8').trim() || 'inconnue';
  } catch {
    // Pas de témoin : premier démarrage de ce conteneur, ou arrêt propre.
  }
  writeFileSync(MARKER, now.toISOString());
  return previous;
}

/** L'arrêt propre retire le témoin : le prochain démarrage ne prendra pas l'arrêt pour un plantage. */
export function markStopped() {
  rmSync(MARKER, { force: true });
}

/**
 * Écrit à la boîte du site, comme la page des retours, que le serveur a redémarré seul. Un mail
 * par heure au plus : un serveur qui plante en boucle ne remplit pas la boîte.
 */
export async function warnCrash(startedAt: string, now = new Date()) {
  log.error('Redémarrage après un arrêt brutal du serveur lancé le', startedAt);
  const to = inbox();
  if (!inboxReady() || !to) return;
  const key = `plantage:${now.toISOString().slice(0, 13)}`;
  const { count } = await db.announcement.createMany({ data: [{ key }], skipDuplicates: true });
  if (count === 0) return;
  await sendMail({
    to,
    subject: 'Project Achievers : le serveur a redémarré après un plantage',
    text: [
      `Le serveur lancé le ${startedAt} s'est arrêté sans passer par l'arrêt propre.`,
      `Docker l'a relancé le ${now.toISOString()}, et le site répond de nouveau.`,
      '',
      'Les causes habituelles : mémoire épuisée (« JavaScript heap out of memory ») ou plantage.',
      'Les dernières lignes du processus mort sont dans le journal du conteneur, sur le NAS :',
      'docker logs --since 2h project-achievers-site-1',
    ].join('\n'),
  });
}
