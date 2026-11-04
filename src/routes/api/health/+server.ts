import { json } from '@sveltejs/kit';
import { logger } from '$lib/logger';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

const log = logger('Santé');

/**
 * Ce que la surveillance du NAS interroge : la base répond-elle, et quelle version tourne ?
 * Une base injoignable répond 503 pour que la surveillance le voie.
 */
export const GET: RequestHandler = async () => {
  let database = 'ok';
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (cause) {
    database = 'indisponible';
    log.error('Base :', cause);
  }

  return json(
    {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      version: process.env.APP_VERSION ?? 'dev',
      uptime: Math.round(process.uptime()),
    },
    { status: database === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
};
