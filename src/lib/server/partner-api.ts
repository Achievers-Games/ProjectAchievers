import { createHash, randomBytes } from 'node:crypto';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { Platform } from '#prisma';
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

/** Les plateformes dans l'adresse, en minuscules : `/games/steam/683320`. */
export const API_PLATFORMS: Record<string, Platform> = {
  steam: 'STEAM',
  psn: 'PSN',
  xbox: 'XBOX',
  retro: 'RETRO',
  blizzard: 'BLIZZARD',
};
export const platformSlug = (platform: Platform) => platform.toLowerCase();

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export type ApiErrorCode =
  'unauthorized' | 'rate_limited' | 'not_found' | 'bad_request' | 'unknown_platform';

/** Toutes les erreurs ont la même forme : un code stable et une phrase pour le développeur. */
export function apiError(status: number, error: ApiErrorCode, message: string, headers = {}) {
  return json({ error, message }, { status, headers });
}

/** La clé ne s'affiche qu'ici : seule son empreinte est gardée. Recréer remplace l'ancienne. */
export async function issuePartnerKey(name: string) {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const data = { keyHash: hashKey(key), keyPrefix: key.slice(0, 10), revokedAt: null };
  const app = await db.partnerApp.upsert({
    where: { name },
    create: { name, ...data },
    update: { ...data, lastUsedAt: null },
  });
  return { app, key };
}

export const revokePartnerKey = (id: string) =>
  db.partnerApp.update({ where: { id }, data: { revokedAt: new Date() } });

const clientAddress = (event: RequestEvent) => {
  try {
    return event.getClientAddress();
  } catch {
    return 'inconnue';
  }
};

/** Le partenaire qui appelle, ou la réponse d'erreur à renvoyer telle quelle. */
export async function authenticatePartner(
  event: RequestEvent,
  now = Date.now(),
): Promise<{ id: string; name: string } | Response> {
  const header = event.request.headers.get('authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const app = key.startsWith(KEY_PREFIX)
    ? await db.partnerApp.findUnique({
        where: { keyHash: hashKey(key) },
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

/** `?limit=` borné et `?cursor=` opaque : l'identifiant du dernier jeu renvoyé. */
export function pageParams(url: URL) {
  const raw = Number(url.searchParams.get('limit') ?? PAGE_LIMIT);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), PAGE_MAX) : PAGE_LIMIT;
  const cursor = url.searchParams.get('cursor')?.slice(0, 64) || null;
  return { limit, cursor };
}

export const absolute = (path: string) => `${env().ORIGIN}${path}`;

export interface ApiGameFields {
  platform: Platform;
  platformGameId: string;
  console: string | null;
  slug: string;
  name: string;
  coverUrl: string | null;
  headerUrl: string | null;
  totalAchievements: number;
  tier: number | null;
}

export const apiGame = (game: ApiGameFields) => ({
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
} as const;
