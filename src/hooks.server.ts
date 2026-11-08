import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/env';
import { themeOf } from '#lib/theme';
import { m } from '#lib/paraglide/messages';
import { getLocale } from '#lib/paraglide/runtime';
import { paraglideMiddleware } from '#lib/paraglide/server';
import { syncCuratedGuides } from '#lib/server/curated-guides';
import { env } from '#lib/server/env';
import { grantFramesThrottled } from '#lib/server/frames';
import { startDigests } from '#lib/server/push-digest';
import { rateLimit } from '#lib/server/rate-limit';
import { validateSession } from '#lib/server/session';
import { logger } from '#lib/logger';
import { startLiveGames } from '#lib/server/sync/live';
import { autoRefresh, startWorkers } from '#lib/server/sync/queue';

const log = logger('Serveur');

export const init: ServerInit = async () => {
  env();
  await startWorkers();
  startLiveGames();
  startDigests();
  await grantFramesThrottled().catch((cause) => log.error('Cadres :', cause));
  await syncCuratedGuides().catch((cause) => log.error('Guides officiels :', cause));
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
  if (request.method !== 'GET' && request.method !== 'HEAD') return 60;
  // Le flux reste ouvert : il ne doit pas bloquer le chat.
  if (path === '/api/sync/events') return null;
  if (!path.startsWith('/api/')) return null;
  // Le parcours e2e ne dispose que d'une adresse pour toutes ses sessions : la présence et le
  // centre de notifications y épuisent le plafond et font tomber des tests sans rapport.
  if (dev && env().DEV_LOGIN === '1') return null;
  return 120;
}

/** Le client peut déjà être parti : ce n'est pas une raison de répondre 500. */
function clientAddress(event: RequestEvent): string {
  try {
    return event.getClientAddress();
  } catch {
    return 'inconnue';
  }
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

  event.locals.user = await validateSession(event.cookies);
  if (event.locals.user && event.request.method === 'GET' && !path.startsWith('/api/')) {
    autoRefresh(event.locals.user.id);
  }

  const response = await resolve(event, {
    // Lu au rendu : une action peut avoir changé le cookie pendant cette requête.
    transformPageChunk: ({ html }) =>
      html
        .replace('%lang%', getLocale())
        .replace('%theme%', themeOf(event.cookies.get('pa_theme'))),
  });

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
};

// Tout le reste s'exécute dans la langue du visiteur, messages d'erreur compris.
export const handle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request }) => {
    // `event.request` n'est plus modifiable : on transmet une copie portant la requête localisée.
    // Une copie par prototype perdrait tout le reste : le kit recopie lui-même l'événement (`{ ...event }`)
    // avant de le résoudre, et n'en garderait que les propriétés propres.
    return secured({ event: { ...event, request }, resolve });
  });
