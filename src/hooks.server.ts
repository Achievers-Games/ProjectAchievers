import { randomBytes } from 'node:crypto';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';
import { themeOf } from '#lib/theme';
import { m } from '#lib/paraglide/messages';
import { extractLocaleFromUrl, getLocale } from '#lib/paraglide/runtime';
import { paraglideMiddleware } from '#lib/paraglide/server';
import { syncCuratedGuides } from '#lib/server/curated-guides';
import { clientAddress } from '#lib/server/client-address';
import { secureCookie } from '#lib/server/cookies';
import { env } from '#lib/server/env';
import { grantFramesThrottled } from '#lib/server/frames';
import { withPartnerFormAction } from '#lib/server/oauth-provider';
import { startDigests } from '#lib/server/push-digest';
import { loadSavedNpsso } from '#lib/server/service-token';
import { rateLimit } from '#lib/server/rate-limit';
import { validateSession } from '#lib/server/session';
import { logger } from '#lib/logger';
import { invalidatePublicCache } from '#lib/server/public-cache';
import { startLiveGames } from '#lib/server/sync/live';
import { autoRefresh, startWorkers, stopWorkers } from '#lib/server/sync/queue';
import { db } from '#lib/server/db';
import { startWorkloadMonitor } from '#lib/server/workload';

const log = logger('Serveur');

export const init: ServerInit = async () => {
  env();
  // Avant les tâches : la synchro PSN doit partir avec le jeton saisi sur le site.
  await loadSavedNpsso().catch((cause) => log.error('Jeton PSN :', cause));
  startWorkloadMonitor();
  await startWorkers();
  startLiveGames();
  startDigests();
  await grantFramesThrottled().catch((cause) => log.error('Cadres :', cause));
  await syncCuratedGuides().catch((cause) => log.error('Guides officiels :', cause));
  // `adapter-node` l'émet sur SIGTERM, une fois les requêtes terminées : la file et la base se
  // ferment proprement au lieu d'attendre que Docker tue le processus.
  process.once('sveltekit:shutdown', () => {
    void stopWorkers()
      .then(() => db.$disconnect())
      .catch((cause) => log.error('Arrêt :', cause))
      .finally(() => process.exit(0));
  });
};

const WINDOW = 60_000;

function limitFor(request: Request, path: string): number | null {
  if (path === '/auth/dev') return null;
  if (path.startsWith('/auth/')) return 20;
  // Un écran en boucle ne doit pas inonder le journal : un rapport par seconde suffit.
  if (path === '/api/erreur') return 10;
  // L'API partenaire limite par clé (`partner-api.ts`) : un partenaire n'a qu'une adresse, et la
  // recherche d'identités est un POST. Passer avant la règle des écritures, sinon les connexions
  // d'un partenaire très fréquenté s'y arrêteraient à 60 par minute.
  if (path.startsWith('/api/v1/')) return null;
  // Même raison pour les jetons OAuth : le partenaire les échange depuis un seul serveur, et
  // `oauth-provider.ts` limite déjà par client.
  if (path === '/oauth/token' || path === '/oauth/revoke') return 600;
  if (request.method !== 'GET' && request.method !== 'HEAD') return 60;
  // Le flux reste ouvert : il ne doit pas bloquer le chat.
  if (path === '/api/sync/events') return null;
  if (!path.startsWith('/api/')) return null;
  // Le parcours e2e ne dispose que d'une adresse pour toutes ses sessions : la présence et le
  // centre de notifications y épuisent le plafond et font tomber des tests sans rapport.
  if (dev && env().DEV_LOGIN === '1') return null;
  return 120;
}

/** Écritures qui ne touchent rien de ce que l'accueil et le classement mettent en cache. */
const PRIVATE_WRITES = [
  '/api/erreur',
  '/api/v1/',
  '/api/push',
  '/api/messages',
  '/api/notifications',
  '/oauth/token',
  '/oauth/revoke',
  '/contact',
  '/retours',
];

/**
 * Le cache public est vidé autour de chaque écriture, et d'un retour de connexion qui peut créer
 * un profil. Un rapport d'erreur du navigateur ou un message privé n'y changent rien : les
 * compter vidait le cache en continu sur un site fréquenté.
 */
function changesPublicData(method: string, path: string) {
  if (method === 'GET' || method === 'HEAD') {
    return path.startsWith('/auth/') && !path.endsWith('/start');
  }
  return !PRIVATE_WRITES.some((prefix) => path.startsWith(prefix));
}

const secured: Handle = async ({ event, resolve }) => {
  // Les cookies et le contrôle d'origine ne valent que pour l'adresse officielle du site.
  const origin = new URL(env().ORIGIN);
  if (event.request.headers.get('host') === `www.${origin.host}`) {
    return new Response(null, {
      status: 301,
      headers: { Location: `${origin.origin}${event.url.pathname}${event.url.search}` },
    });
  }

  const path = event.url.pathname;
  const limit = limitFor(event.request, path);
  if (limit !== null) {
    if (!rateLimit(`${clientAddress(event)}:${limit}`, limit, WINDOW)) {
      return new Response(m.rate_limited(), {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
  }

  // Arrivé par /en/… : la suite de la visite reste en anglais, même par les liens sans préfixe.
  const urlLocale = extractLocaleFromUrl(event.url);
  if (urlLocale && event.cookies.get('pa_lang') !== urlLocale) {
    event.cookies.set('pa_lang', urlLocale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 400,
      sameSite: 'lax',
      // Lu par le navigateur pour le sélecteur de langue, mais jamais envoyé en clair en production.
      httpOnly: false,
      secure: secureCookie.secure,
    });
  }

  const started = performance.now();
  event.locals.user = await validateSession(event.cookies);
  if (event.locals.user && event.request.method === 'GET' && !path.startsWith('/api/')) {
    autoRefresh(event.locals.user.id);
  }

  const mutation = changesPublicData(event.request.method, path);
  if (mutation) invalidatePublicCache();
  let response: Response;
  try {
    response = await resolve(event, {
      // Lu au rendu : une action peut avoir changé le cookie pendant cette requête.
      transformPageChunk: ({ html }) =>
        html
          .replace('%lang%', getLocale())
          .replace('%theme%', themeOf(event.cookies.get('pa_theme'))),
    });
  } finally {
    if (mutation) invalidatePublicCache();
  }
  if (!path.startsWith('/api/') && event.request.method === 'GET') {
    const duration = Math.round(performance.now() - started);
    response.headers.append('Server-Timing', `app;dur=${duration}`);
    if (duration >= 500) log.warn('Page lente', { route: event.route.id, durationMs: duration });
  }
  const csp = response.headers.get('content-security-policy');
  if (path === '/oauth/authorize' && csp) {
    response.headers.set(
      'content-security-policy',
      await withPartnerFormAction(csp, event.url.searchParams),
    );
  }

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
};

/**
 * Une panne imprévue part au journal avec sa route et une référence courte, que la page d'erreur
 * montre au joueur : un signalement se retrouve alors dans `docker compose logs site`. Les erreurs
 * prévues (`error(404)`, pages introuvables) n'y vont pas.
 */
export const handleError: HandleServerError = ({ kind, error, event }) => {
  if (kind !== 'unknown') return;
  const reference = randomBytes(4).toString('hex');
  log.error(
    `Panne ${reference}`,
    {
      method: event.request.method,
      route: event.route.id,
      path: event.url.pathname,
    },
    error,
  );
  return { message: `${m.error_generic()} · ${reference}` };
};

// Tout le reste s'exécute dans la langue du visiteur, messages d'erreur compris.
export const handle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request }) => {
    // `event.request` n'est plus modifiable : on transmet une copie portant la requête localisée.
    // Une copie par prototype perdrait tout le reste : le kit recopie lui-même l'événement (`{ ...event }`)
    // avant de le résoudre, et n'en garderait que les propriétés propres.
    return secured({ event: { ...event, request }, resolve });
  });
