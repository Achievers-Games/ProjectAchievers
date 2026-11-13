import { createHash } from 'node:crypto';
import { env } from './env';
import { logger } from '#lib/logger';

/**
 * IndexNow : prévient Bing (et Yandex, Seznam, Naver…) dès qu'une page publique change,
 * sans attendre qu'ils relisent le plan du site. Google ne le prend pas en charge.
 */

const log = logger('IndexNow');

const ENDPOINT = 'https://api.indexnow.org/indexnow';
/** Le chemin du fichier de clé : les moteurs y vérifient que l'annonce vient bien du site. */
export const KEY_PATH = '/indexnow.txt';
/** Les publications d'une même minute partent ensemble : une requête plutôt que dix. */
const DELAY = 30_000;
/** La limite d'une annonce fixée par le protocole. */
const MAX_URLS = 10_000;

/**
 * Tirée du secret du serveur : stable d'un redémarrage à l'autre, sans rien à configurer.
 * Le hachage ne laisse rien deviner du secret, et la clé est publique par nature.
 */
export const indexNowKey = (secret = env().ENCRYPTION_KEY) =>
  createHash('sha256').update(`indexnow:${secret}`).digest('hex').slice(0, 32);

/** Seul le site public annonce ses pages : jamais le développement, les tests ou un localhost. */
export function indexNowEnabled(origin = env().ORIGIN, mode = process.env.NODE_ENV) {
  if (mode !== 'production') return false;
  const { protocol, hostname } = new URL(origin);
  return (
    protocol === 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(hostname) &&
    !hostname.endsWith('.localhost')
  );
}

/** Le corps attendu par le protocole, pour des chemins du site. */
export function indexNowPayload(origin: string, key: string, paths: Iterable<string>) {
  return {
    host: new URL(origin).host,
    key,
    keyLocation: `${origin}${KEY_PATH}`,
    urlList: [...new Set(paths)].slice(0, MAX_URLS).map((path) => new URL(path, origin).href),
  };
}

const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Envoie ce qui attend ; un échec se contente d'un avertissement, le plan du site prendra le relais. */
async function flushIndexNow() {
  timer = null;
  if (!pending.size) return;
  const paths = [...pending];
  pending.clear();
  const { ORIGIN } = env();
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(indexNowPayload(ORIGIN, indexNowKey(), paths)),
      signal: AbortSignal.timeout(10_000),
    });
    // 200 et 202 valent accord ; le reste signale une clé refusée ou un abus.
    if (!response.ok) log.warn(`Annonce refusée (${response.status}) pour ${paths.length} page(s)`);
  } catch (cause) {
    log.warn('Annonce impossible :', cause instanceof Error ? cause.message : cause);
  }
}

/** Signale des pages publiques nouvelles ou modifiées, sans jamais retarder la réponse. */
export function announce(...paths: string[]) {
  if (!indexNowEnabled()) return;
  for (const path of paths) pending.add(path);
  if (!timer) {
    timer = setTimeout(() => void flushIndexNow(), DELAY);
    // L'annonce ne doit pas empêcher le serveur de s'arrêter.
    timer.unref?.();
  }
}
