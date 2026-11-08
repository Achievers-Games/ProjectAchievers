import { apiJson } from '#lib/server/partner-api';
import { partnerUser } from '#lib/server/partner-queries';
import { meRoute } from '#lib/server/oauth-provider';
import type { RequestHandler } from './$types';

/** Le joueur qui a donné son accord : son profil, même privé. Portée `profile`. */
export const GET: RequestHandler = meRoute('profile', async (_event, userId) =>
  apiJson(await partnerUser({ userId })),
);
