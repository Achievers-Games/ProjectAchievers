import type { Handle, RequestEvent, ServerInit } from '@sveltejs/kit';
import { env } from '$lib/server/env';
import { rateLimit } from '$lib/server/rate-limit';
import { validateSession } from '$lib/server/session';
import { startWorkers } from '$lib/server/sync/queue';

export const init: ServerInit = async () => {
  env();
  await startWorkers();
};

const WINDOW = 60_000;

function limitFor(request: Request, path: string): number | null {
  if (path === '/auth/dev') return null;
  if (path.startsWith('/auth/')) return 20;
  if (request.method !== 'GET' && request.method !== 'HEAD') return 60;
  return path.startsWith('/api/') ? 120 : null;
}

/** Le client peut déjà être parti : ce n'est pas une raison de répondre 500. */
function clientAddress(event: RequestEvent): string {
  try {
    return event.getClientAddress();
  } catch {
    return 'inconnue';
  }
}

export const handle: Handle = async ({ event, resolve }) => {
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
      return new Response('Trop de requêtes, réessaie dans une minute.', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
  }

  event.locals.user = await validateSession(event.cookies);

  const response = await resolve(event, {
    // Lu au rendu : une action peut avoir changé le cookie pendant cette requête.
    transformPageChunk: ({ html }) =>
      html.replace('%theme%', event.cookies.get('pa_theme') === 'light' ? 'light' : 'dark'),
  });

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
};
