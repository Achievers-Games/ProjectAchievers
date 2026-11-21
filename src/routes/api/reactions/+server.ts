import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  cardReactionTarget,
  liveReactions,
  unlockReactions,
  unlockThreadFor,
} from '#lib/server/activity';
import { db } from '#lib/server/db';
import { ACTIVITY_EMOJIS } from '#lib/activity';
import { rateLimit } from '#lib/server/rate-limit';
import type { RequestHandler } from './$types';

const reaction = z.object({
  kind: z.enum(['card', 'unlock']),
  handle: z.string().min(1).max(64),
  id: z.string().min(1).max(256),
  emoji: z.enum(ACTIVITY_EMOJIS),
  active: z.boolean(),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  const viewer = locals.user;
  if (!viewer) error(401);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') error(415);
  const parsed = reaction.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400);
  if (!rateLimit(`activity-reaction:${viewer.id}`, 60, 60_000)) error(429);
  const { kind, handle, id, emoji, active } = parsed.data;
  if (kind === 'card') {
    const card = await cardReactionTarget(viewer, handle, id);
    if (!card) error(404);
    const where = { ownerId: card.userId, gameId: card.gameId, userId: viewer.id };
    if (active) {
      await db.liveReaction.upsert({
        where: { ownerId_gameId_userId: where },
        create: { ...where, emoji },
        update: { emoji },
      });
    } else await db.liveReaction.deleteMany({ where: { ...where, emoji } });
    const summaries = await liveReactions(
      [{ ownerId: where.ownerId, gameId: where.gameId }],
      viewer.id,
    );
    return json(summaries.get(`${where.ownerId}/${where.gameId}`) ?? { counts: {}, mine: null });
  }

  const unlock = await unlockThreadFor(viewer, handle, id);
  if (!unlock) error(404);
  const where = { ownerId: unlock.userId, achievementId: unlock.achievement.id, userId: viewer.id };
  if (active) {
    await db.unlockReaction.upsert({
      where: { ownerId_achievementId_userId: where },
      create: { ...where, emoji },
      update: { emoji },
    });
  } else await db.unlockReaction.deleteMany({ where: { ...where, emoji } });
  return json(await unlockReactions(where.ownerId, where.achievementId, viewer.id));
};
