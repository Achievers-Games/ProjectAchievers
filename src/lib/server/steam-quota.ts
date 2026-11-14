import { logger } from '#lib/logger';

/**
 * Steam accorde environ 100 000 appels par jour à une clé. Au-delà il répond 429 et tout
 * s'arrête, suivi en direct compris : le compteur dit où on en est avant d'y arriver.
 */
export const STEAM_DAILY_QUOTA = 100_000;
const WARN_AT = 0.8;
const log = logger('Quota Steam');

let day = '';
let total = 0;
let warned = false;
const byMethod = new Map<string, number>();

const today = (now = new Date()) => now.toISOString().slice(0, 10);

function rollOver(now = new Date()) {
  const current = today(now);
  if (current === day) return;
  if (day) log.info('Bilan de la journée', { day, total, ...Object.fromEntries(byMethod) });
  day = current;
  total = 0;
  warned = false;
  byMethod.clear();
}

/** Une adresse de l'API Steam : la méthode est le segment avant la version (`…/GetX/v1/`). */
export function countSteamCall(url: string | URL) {
  rollOver();
  const method = /\/([A-Za-z]+)\/v\d+\/?/.exec(new URL(url).pathname)?.[1] ?? 'autre';
  byMethod.set(method, (byMethod.get(method) ?? 0) + 1);
  total++;
  if (!warned && total >= STEAM_DAILY_QUOTA * WARN_AT) {
    warned = true;
    log.warn(`${total} appels Steam aujourd'hui, ${WARN_AT * 100} % du quota`, {
      ...Object.fromEntries(byMethod),
    });
  }
}

/** Les appels du jour, pour le relevé de charge de chaque minute. */
export function steamCalls() {
  rollOver();
  return { total, byMethod: Object.fromEntries(byMethod) };
}
