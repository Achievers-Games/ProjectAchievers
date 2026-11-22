import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { rateLimit } from '#lib/server/rate-limit';
import { dismissSuggestion } from '#lib/server/recommendations';
import type { RequestHandler } from './$types';

const body = z.object({ gameId: z.string().min(1).max(64), dismissed: z.boolean() });

/** « Pas intéressé » sur une suggestion de l'accueil, et son annulation. */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) error(401);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') error(415);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400);
  if (!rateLimit(`suggestion:${locals.user.id}`, 60, 60_000)) error(429);
  const { gameId, dismissed } = parsed.data;
  if (!(await dismissSuggestion(locals.user.id, gameId, dismissed))) error(404);
  return json({ dismissed });
};
