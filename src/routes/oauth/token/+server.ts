import { invalidRequest, readJson, tokenEndpoint } from '#lib/server/oauth-provider';
import type { RequestHandler } from './$types';

/**
 * Le corps est en JSON : la protection CSRF du site refuse les formulaires venus d'ailleurs,
 * et un serveur partenaire n'envoie pas d'en-tête `Origin`.
 */
export const POST: RequestHandler = async (event) => {
  const body = await readJson(event);
  return body ? tokenEndpoint(body) : invalidRequest();
};
