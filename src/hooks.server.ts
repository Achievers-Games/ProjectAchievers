import type { Handle, ServerInit } from '@sveltejs/kit';
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
  if (path.startsWith('/auth/')) return 20;
  if (request.method !== 'GET' && request.method !== 'HEAD') return 60;
  return path.startsWith('/api/') ? 120 : null;
}

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const limit = limitFor(event.request, path);
  if (limit !== null) {
    const key = `${event.getClientAddress()}:${path.split('/').slice(0, 3).join('/')}`;
    if (!rateLimit(key, limit, WINDOW)) {
      return new Response('Trop de requêtes, réessaie dans une minute.', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
  }

  event.locals.user = await validateSession(event.cookies);
  const theme = event.cookies.get('pa_theme');

  const response = await resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace('%theme%', theme === 'light' || theme === 'dark' ? theme : 'dark'),
  });

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
};
