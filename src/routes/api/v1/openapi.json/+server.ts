import { json } from '@sveltejs/kit';
import { env } from '#lib/server/env';
import { partnerOpenApi } from '#lib/server/partner-openapi';
import type { RequestHandler } from './$types';

/** La description se lit sans clé : c'est ce qu'un développeur ouvre en premier. */
export const GET: RequestHandler = () =>
  json(partnerOpenApi(env().ORIGIN), {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  });
