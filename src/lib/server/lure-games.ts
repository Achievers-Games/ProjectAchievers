import type { Platform } from '#prisma';
import { db } from './db';
import { env } from './env';
import { logger } from '#lib/logger';
import { steamAppIds } from './partner-api';

const log = logger('Lure');

/** Une fiche connue se relit chaque semaine ; un jeu absent, chaque jour (Lure en ajoute). */
const FRESH = 7 * 24 * 60 * 60 * 1000;
const RETRY = 24 * 60 * 60 * 1000;
const TIMEOUT = 3000;

export interface LureGameInfo {
  url: string;
  /** En minutes, `null` si Lure ne le sait pas. */
  mainMinutes: number | null;
  normalMinutes: number | null;
  completionistMinutes: number | null;
}

const minutes = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

/**
 * Lit un jeu de la réponse de Lure : `time_to_beat` (`main_minutes`, `normal_minutes`,
 * `completionist_minutes`), comme dans leur `/me/games`, et `url` s'ils l'ajoutent un jour.
 * Une réponse inattendue ne donne rien plutôt qu'une donnée fausse.
 */
export function parseLureGame(body: unknown, fallbackUrl: string): LureGameInfo | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;
  const game = (data.game && typeof data.game === 'object' ? data.game : data) as Record<
    string,
    unknown
  >;
  const times = (
    game.time_to_beat && typeof game.time_to_beat === 'object' ? game.time_to_beat : {}
  ) as Record<string, unknown>;
  const url =
    typeof game.url === 'string' && game.url.startsWith('https://') ? game.url : fallbackUrl;
  return {
    url,
    mainMinutes: minutes(times.main_minutes),
    normalMinutes: minutes(times.normal_minutes),
    completionistMinutes: minutes(times.completionist_minutes),
  };
}

const baseUrl = () => env().LURE_API_URL?.replace(/\/+$/, '') ?? null;

/**
 * Interroge Lure (`POST /api/v1/partner/games/times`) et garde la réponse, trouvée ou non. Un jeu
 * listé dans `missing` n'a pas de temps connu chez Lure. Ne lève jamais : une panne ne coûte rien.
 */
async function refresh(steamAppId: string, fetcher: typeof fetch) {
  const base = baseUrl();
  const key = env().LURE_API_KEY;
  if (!base || !key) return;
  let info: LureGameInfo | null = null;
  try {
    const response = await fetcher(`${base}/api/v1/partner/games/times`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ games: [{ platform: 'steam', id: steamAppId }] }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    // Une page HTML à la place du JSON, c'est que la route n'est pas (ou plus) là : on réessaiera.
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      log.warn(`temps Lure ${steamAppId} : ${response.status}`);
      return;
    }
    const body = (await response.json()) as { items?: unknown };
    const item = Array.isArray(body.items)
      ? (body.items as Record<string, unknown>[]).find(
          (entry) => entry && String(entry.id) === steamAppId,
        )
      : undefined;
    info = item ? parseLureGame(item, `${base}/jeu/${steamAppId}`) : null;
    // Un jeu connu sans aucune durée ne vaut pas mieux qu'un jeu absent.
    if (info && !info.mainMinutes && !info.normalMinutes && !info.completionistMinutes) {
      info = null;
    }
  } catch (cause) {
    log.warn(`temps Lure ${steamAppId} :`, cause);
    return;
  }
  const data = {
    found: info !== null,
    url: info?.url ?? null,
    mainMinutes: info?.mainMinutes ?? null,
    normalMinutes: info?.normalMinutes ?? null,
    completionistMinutes: info?.completionistMinutes ?? null,
    fetchedAt: new Date(),
  };
  await db.lureGame.upsert({
    where: { steamAppId },
    create: { steamAppId, ...data },
    update: data,
  });
}

const pending = new Set<string>();

/**
 * Ce que Lure sait d'un jeu, pour sa fiche Achievers : le lien vers la fiche Lure et le temps pour
 * le finir. La page n'attend jamais Lure : elle montre ce qui est déjà gardé, et une fiche trop
 * vieille se relit en arrière-plan pour la visite suivante. Un jeu PSN ou Xbox passe par l'appid
 * de sa version Steam.
 */
export async function lureGameFor(
  game: { platform: Platform; platformGameId: string; familyKey: string | null },
  { now = Date.now(), fetcher = fetch, wait = false } = {},
): Promise<LureGameInfo | null> {
  if (!baseUrl() || !env().LURE_API_KEY) return null;
  const steamAppId =
    game.platform === 'STEAM'
      ? game.platformGameId
      : ((await steamAppIds([game])).get(game.familyKey ?? '') ?? null);
  if (!steamAppId) return null;

  const cached = await db.lureGame.findUnique({ where: { steamAppId } });
  const age = cached ? now - cached.fetchedAt.getTime() : Infinity;
  if (age > (cached?.found ? FRESH : RETRY) && !pending.has(steamAppId)) {
    pending.add(steamAppId);
    const job = refresh(steamAppId, fetcher).finally(() => pending.delete(steamAppId));
    if (wait) await job;
    else void job;
  }

  const current = wait ? await db.lureGame.findUnique({ where: { steamAppId } }) : cached;
  if (!current?.found || !current.url) return null;
  return {
    url: current.url,
    mainMinutes: current.mainMinutes,
    normalMinutes: current.normalMinutes,
    completionistMinutes: current.completionistMinutes,
  };
}
