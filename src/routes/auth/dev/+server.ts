import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import { db } from '#lib/server/db';
import { env } from '#lib/server/env';
import { createSession } from '#lib/server/session';
import type { RequestHandler } from './$types';

/** Connexion de démonstration. N'existe qu'avec `vite dev` et DEV_LOGIN=1. */
export const GET: RequestHandler = async ({ url, cookies }) => {
  if (!dev || env().DEV_LOGIN !== '1') error(404, 'Page introuvable');

  const handle = url.searchParams.get('compte') ?? 'demo';
  const user = await db.user.findUnique({ where: { handle } });
  if (!user) error(404, 'Compte de démonstration introuvable : lance `npm run db:seed`.');

  await createSession(cookies, user.id, 'dev');
  redirect(303, '/');
};
