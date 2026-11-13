import { randomBytes } from 'node:crypto';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { Platform } from '#prisma';
import { clientAddress } from './client-address';
import { sha256 } from './crypto';
import { db } from './db';
import { env } from './env';
import { rateLimit } from './rate-limit';

const KEY_PREFIX = 'ak_';
const MINUTE = 60_000;
/** Un partenaire appelle depuis un seul serveur : la limite suit sa clé, pas son adresse. */
export const KEY_LIMIT = 600;
/** Les essais de clé ratés, par adresse : de quoi corriger une faute, pas de deviner. */
const FAILED_LIMIT = 30;
/** Écrire la date d'usage à chaque appel chargerait la base pour rien. */
const TOUCH_EVERY = 5 * MINUTE;

export const PAGE_LIMIT = 50;
export const PAGE_MAX = 100;
/** Une bibliothèque se lit par lots : au-delà, le partenaire découpe sa liste. */
export const LOOKUP_MAX = 100;

/**
 * Les ordres proposés. `default` garde l'ordre historique de la première version de l'API :
 * stable d'une page à l'autre, mais sans signification pour le partenaire.
 */
export type ApiSort = 'default' | 'name' | 'completion' | 'lastUnlocked' | 'updated';
const SORTS: ApiSort[] = ['default', 'name', 'completion', 'lastUnlocked', 'updated'];
export const API_SORT_KEYS = SORTS.filter((sort) => sort !== 'default');

/** Où en est le joueur sur le jeu : fini, commencé, ou à peine lancé. */
export type ApiGameStatus = 'completed' | 'started' | 'untouched';
export const API_STATUS_KEYS: ApiGameStatus[] = ['completed', 'started', 'untouched'];
const STATUSES = API_STATUS_KEYS;

/** Les plateformes dans l'adresse, en minuscules : `/games/steam/683320`. */
export const API_PLATFORMS: Record<string, Platform> = {
  steam: 'STEAM',
  psn: 'PSN',
  xbox: 'XBOX',
  retro: 'RETRO',
  blizzard: 'BLIZZARD',
};
export const platformSlug = (platform: Platform) => platform.toLowerCase();

type ApiErrorCode =
  'unauthorized' | 'rate_limited' | 'not_found' | 'bad_request' | 'unknown_platform';

/** Toutes les erreurs ont la même forme : un code stable et une phrase pour le développeur. */
export function apiError(status: number, error: ApiErrorCode, message: string, headers = {}) {
  return json({ error, message }, { status, headers });
}

/** La clé ne s'affiche qu'ici : seule son empreinte est gardée. Recréer remplace l'ancienne. */
export async function issuePartnerKey(name: string) {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const data = { keyHash: sha256(key), keyPrefix: key.slice(0, 10), revokedAt: null };
  const app = await db.partnerApp.upsert({
    where: { name },
    create: { name, ...data },
    update: { ...data, lastUsedAt: null },
  });
  return { app, key };
}

export const revokePartnerKey = (id: string) =>
  db.partnerApp.update({ where: { id }, data: { revokedAt: new Date() } });

/** Le partenaire qui appelle, ou la réponse d'erreur à renvoyer telle quelle. */
export async function authenticatePartner(
  event: RequestEvent,
  now = Date.now(),
): Promise<{ id: string; name: string } | Response> {
  const header = event.request.headers.get('authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const app = key.startsWith(KEY_PREFIX)
    ? await db.partnerApp.findUnique({
        where: { keyHash: sha256(key) },
        select: { id: true, name: true, revokedAt: true, lastUsedAt: true },
      })
    : null;

  if (!app || app.revokedAt) {
    if (!rateLimit(`api-v1-echec:${clientAddress(event)}`, FAILED_LIMIT, MINUTE, now)) {
      return apiError(429, 'rate_limited', 'Too many invalid keys.', { 'Retry-After': '60' });
    }
    return apiError(401, 'unauthorized', 'Missing, unknown or revoked API key.', {
      'WWW-Authenticate': 'Bearer',
    });
  }
  if (!rateLimit(`api-v1:${app.id}`, KEY_LIMIT, MINUTE, now)) {
    return apiError(429, 'rate_limited', `Limit is ${KEY_LIMIT} requests per minute.`, {
      'Retry-After': '60',
    });
  }
  if (!app.lastUsedAt || now - app.lastUsedAt.getTime() > TOUCH_EVERY) {
    await db.partnerApp.update({ where: { id: app.id }, data: { lastUsedAt: new Date(now) } });
  }
  return { id: app.id, name: app.name };
}

/** Une route de l'API : la clé est vérifiée avant toute lecture. */
export const partnerRoute =
  <E extends RequestEvent>(handler: (event: E) => Promise<Response> | Response) =>
  async (event: E) => {
    const partner = await authenticatePartner(event);
    if (partner instanceof Response) return partner;
    return handler(event);
  };

/** Une plateforme de l'adresse, ou `null` si elle n'existe pas. */
export const parsePlatform = (value: string) => API_PLATFORMS[value.toLowerCase()] ?? null;

export const unknownPlatform = (value: string) =>
  apiError(
    400,
    'unknown_platform',
    `Unknown platform "${value.slice(0, 20)}". Use one of: ${Object.keys(API_PLATFORMS).join(', ')}.`,
  );

export const notFound = (what: string) => apiError(404, 'not_found', `${what} not found.`);

/** Une réponse fraîche quelques minutes : le partenaire peut la garder en cache. */
export const apiJson = (body: unknown) =>
  json(body, { headers: { 'Cache-Control': 'private, max-age=300' } });

/**
 * Un curseur dit où reprendre : l'ordre et la valeur de tri du dernier élément rendu, plus son
 * identifiant pour départager deux valeurs égales. Il est opaque, et se refuse s'il vient d'un
 * autre ordre — sinon la suite d'une page serait celle d'un tri qu'on n'a pas demandé.
 */
export interface ApiCursor {
  sort: ApiSort;
  value: string | number | null;
  id: string;
}

/** Préfixe des curseurs récents : sans lui, un curseur reste l'identifiant du dernier jeu. */
const CURSOR_PREFIX = 'k1.';

const encodeCursor = (cursor: ApiCursor) =>
  CURSOR_PREFIX +
  Buffer.from(JSON.stringify([cursor.sort, cursor.value, cursor.id])).toString('base64url');

/** Le curseur du dernier élément rendu, ou `null` : le partenaire ne fabrique jamais un id. */
export function nextCursor(
  sort: ApiSort,
  last: {
    gameId: string;
    completion: number;
    lastUnlockedAt: Date | null;
    updatedAt: Date;
    game: { name: string };
  },
) {
  // L'ordre par défaut garde le curseur d'origine : l'identifiant du dernier jeu, tel quel.
  if (sort === 'default') return last.gameId;
  const value =
    sort === 'completion'
      ? last.completion
      : sort === 'updated'
        ? last.updatedAt.toISOString()
        : sort === 'lastUnlocked'
          ? (last.lastUnlockedAt?.toISOString() ?? null)
          : last.game.name;
  return encodeCursor({ sort, value, id: last.gameId });
}

const invalidCursor = () => apiError(400, 'bad_request', 'Invalid cursor.');

const isDate = (value: unknown) =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

/** Ce que chaque tri range dans son curseur : un nombre, une date ou un nom. */
function cursorValueFits(sort: ApiSort, value: unknown): value is string | number | null {
  switch (sort) {
    case 'completion':
      return typeof value === 'number' && Number.isFinite(value);
    case 'updated':
      return isDate(value);
    case 'lastUnlocked':
      // Les jeux jamais débloqués ferment la liste : leur curseur ne porte pas de date.
      return value === null || isDate(value);
    case 'name':
      return typeof value === 'string';
    case 'default':
      return value === null;
  }
}

/** Le curseur reçu, ou la réponse `400` qui explique pourquoi il ne vaut rien pour cet ordre. */
function decodeCursor(raw: string, sort: ApiSort): ApiCursor | Response {
  if (!raw.startsWith(CURSOR_PREFIX)) {
    // Curseur de la première version : l'identifiant du dernier jeu, valable pour l'ordre par défaut.
    return sort === 'default'
      ? { sort, value: null, id: raw }
      : apiError(400, 'bad_request', 'This cursor belongs to the default order: drop sort.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    return invalidCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return invalidCursor();
  const [cursorSort, value, id] = parsed as [unknown, unknown, unknown];
  if (cursorSort !== sort)
    return apiError(400, 'bad_request', 'This cursor belongs to another sort.');
  if (typeof id !== 'string' || !id) return invalidCursor();
  // La valeur doit avoir le type de son tri : une date illisible ou un pourcentage qui n'en est
  // pas finirait en erreur 500 dans la requête, au lieu d'un refus clair.
  return cursorValueFits(sort, value) ? { sort, value, id } : invalidCursor();
}

interface GameListParams {
  limit: number;
  sort: ApiSort;
  status: ApiGameStatus | null;
  since: Date | null;
  cursor: ApiCursor | null;
}

const badRequest = (message: string) => apiError(400, 'bad_request', message);

/**
 * `?limit=`, `?sort=`, `?status=`, `?since=` et `?cursor=` lus et validés. Une valeur incomprise
 * est refusée plutôt que remplacée en silence : le partenaire voit son erreur au premier appel.
 */
export function listParams(url: URL): GameListParams | Response {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? PAGE_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) {
    return badRequest(`limit must be a whole number from 1 to ${PAGE_MAX}.`);
  }

  const sort = (url.searchParams.get('sort') ?? 'default') as ApiSort;
  if (!SORTS.includes(sort)) {
    return badRequest(`sort must be one of: ${API_SORT_KEYS.join(', ')}.`);
  }

  const rawStatus = url.searchParams.get('status');
  const status = rawStatus as ApiGameStatus;
  if (rawStatus !== null && !STATUSES.includes(status)) {
    return badRequest(`status must be one of: ${STATUSES.join(', ')}.`);
  }

  const rawSince = url.searchParams.get('since');
  const since = rawSince ? new Date(rawSince) : null;
  if (rawSince && Number.isNaN(since!.getTime())) {
    return badRequest('since must be an ISO 8601 date-time, e.g. 2026-01-31T00:00:00Z.');
  }

  const rawCursor = url.searchParams.get('cursor')?.slice(0, 256) || null;
  const cursor = rawCursor ? decodeCursor(rawCursor, sort) : null;
  if (cursor instanceof Response) return cursor;

  return {
    limit,
    sort,
    status: rawStatus ? status : null,
    since,
    cursor,
  };
}

export const absolute = (path: string) => `${env().ORIGIN}${path}`;

/**
 * L'avatar d'un joueur, toujours en `https://` ou `null` : les plateformes en donnent parfois en
 * `http://` (PSN), qu'elles servent aussi en HTTPS, et un site partenaire ne peut pas les afficher.
 */
export function apiAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  if (url.startsWith('/')) return absolute(url);
  return null;
}

interface ApiGameFields {
  platform: Platform;
  platformGameId: string;
  console: string | null;
  slug: string;
  name: string;
  coverUrl: string | null;
  headerUrl: string | null;
  totalAchievements: number;
  tier: number | null;
  tags: number[];
  familyKey: string | null;
}

/**
 * Les appid Steam par famille de jeux : la version Steam d'un jeu PSN ou Xbox, quand elle existe.
 * Les fiches de Lure sont rangées par appid Steam : c'est ce qui y relie un 100 % sur PS5.
 */
export async function steamAppIds(games: { platform: Platform; familyKey: string | null }[]) {
  const families = [
    ...new Set(
      games.flatMap((game) =>
        game.platform !== 'STEAM' && game.familyKey ? [game.familyKey] : [],
      ),
    ),
  ];
  if (families.length === 0) return new Map<string, string>();
  const steam = await db.game.findMany({
    where: { platform: 'STEAM', familyKey: { in: families } },
    orderBy: { platformGameId: 'asc' },
    select: { familyKey: true, platformGameId: true },
  });
  const ids = new Map<string, string>();
  for (const game of steam) {
    if (game.familyKey && !ids.has(game.familyKey)) ids.set(game.familyKey, game.platformGameId);
  }
  return ids;
}

export const apiGame = (game: ApiGameFields, steamIds: Map<string, string> = new Map()) => ({
  platform: platformSlug(game.platform),
  platformGameId: game.platformGameId,
  console: game.console,
  slug: game.slug,
  name: game.name,
  url: absolute(`/jeux/${game.slug}`),
  coverUrl: game.coverUrl,
  headerUrl: game.headerUrl,
  totalAchievements: game.totalAchievements,
  tier: game.tier,
  tags: game.tags,
  familyKey: game.familyKey,
  steamAppId:
    game.platform === 'STEAM'
      ? game.platformGameId
      : game.familyKey
        ? (steamIds.get(game.familyKey) ?? null)
        : null,
});

export const apiGameSelect = {
  platform: true,
  platformGameId: true,
  console: true,
  slug: true,
  name: true,
  coverUrl: true,
  headerUrl: true,
  totalAchievements: true,
  tier: true,
  tags: true,
  familyKey: true,
} as const;

/** Le rang d'une carte, du palier 1 au palier 6, comme sur le site. */
const CARD_RANKS = ['bronze', 'silver', 'gold', 'diamond', 'prismatic', 'legendary'] as const;

/** La carte qu'un 100 % rapporte : son palier dit la difficulté du jeu, de Bronze à Légendaire. */
export function apiCard(gameTier: number | null) {
  const tier = Math.min(Math.max(gameTier ?? 1, 1), CARD_RANKS.length);
  return { tier, rank: CARD_RANKS[tier - 1] };
}
