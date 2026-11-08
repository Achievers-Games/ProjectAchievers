import { invalidRequest, readJson, revokeEndpoint } from '#lib/server/oauth-provider';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const body = await readJson(event);
  return body ? revokeEndpoint(body) : invalidRequest();
};
