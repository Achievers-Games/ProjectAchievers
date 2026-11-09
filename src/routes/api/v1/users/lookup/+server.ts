import { z } from 'zod';
import { API_PLATFORMS, apiError, apiJson, notFound, partnerRoute } from '#lib/server/partner-api';
import { partnerUser, partnerUsersLookup, USERS_LOOKUP_MAX } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

const schema = z.object({
  users: z.array(z.string().trim().min(1).max(64)).min(1).max(USERS_LOOKUP_MAX),
  // « steam:219150 » : la progression de chacun sur ce jeu, pour un classement entre amis.
  game: z
    .string()
    .regex(/^[a-z]+:[^\s:]{1,64}$/)
    .optional(),
});

/** Jusqu'à 100 joueurs en un appel, par handle ou par id. */
export const POST: RequestHandler = partnerRoute(async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'bad_request', 'Body must be JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      'bad_request',
      `users must hold 1 to ${USERS_LOOKUP_MAX} handles or ids; game looks like steam:219150.`,
    );
  }
  let game = null;
  if (parsed.data.game) {
    const [slug = '', platformGameId = ''] = parsed.data.game.split(':');
    const platform = API_PLATFORMS[slug];
    if (!platform) {
      return apiError(
        400,
        'unknown_platform',
        `Unknown platform "${slug}". Use one of: ${Object.keys(API_PLATFORMS).join(', ')}.`,
      );
    }
    game = { platform, platformGameId };
  }
  return apiJson(await partnerUsersLookup(parsed.data.users, game));
});

// « lookup » est aussi un handle possible : son profil garde son adresse.
export const GET: RequestHandler = partnerRoute(async () => {
  const user = await partnerUser('lookup');
  return user ? apiJson(user) : notFound('Public profile');
});
