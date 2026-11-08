import { z } from 'zod';
import {
  API_PLATFORMS,
  apiError,
  apiJson,
  LOOKUP_MAX,
  partnerRoute,
  platformSlug,
} from '#lib/server/partner-api';
import { partnerGames, type GameKey } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

const schema = z.object({
  games: z
    .array(
      z.object({
        platform: z.string().transform((value) => API_PLATFORMS[value.toLowerCase()]),
        id: z.string().trim().min(1).max(64),
      }),
    )
    .min(1)
    .max(LOOKUP_MAX),
});

/**
 * Les fiches de jusqu'à 100 jeux en un appel : une bibliothèque de 300 jeux se lit en 3 requêtes.
 * L'ordre des fiches suit celui de la demande ; les jeux inconnus ou adultes vont dans `missing`.
 */
export const POST: RequestHandler = partnerRoute(async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'bad_request', 'Body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data.games.some((game) => !game.platform)) {
    return apiError(
      400,
      'bad_request',
      `games must hold 1 to ${LOOKUP_MAX} {platform, id} entries; platform is one of: ${Object.keys(API_PLATFORMS).join(', ')}.`,
    );
  }

  const keys: GameKey[] = parsed.data.games.map((game) => ({
    platform: game.platform!,
    platformGameId: game.id,
  }));
  const found = await partnerGames(keys);

  const seen = new Set<string>();
  const items = [];
  const missing = [];
  for (const key of keys) {
    const id = `${key.platform}:${key.platformGameId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const game = found.get(id);
    if (game) items.push(game);
    else missing.push({ platform: platformSlug(key.platform), id: key.platformGameId });
  }
  return apiJson({ items, missing });
});
