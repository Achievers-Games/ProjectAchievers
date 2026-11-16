import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { listConversations, openDirect } from '#lib/server/social';
import { rateLimit } from '#lib/server/rate-limit';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

const OPENS_PER_MINUTE = 30;

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());
  return json(await listConversations(locals.user.id));
};

/** Ouvre la discussion avec un ami, ou retrouve celle qui existe déjà. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  const parsed = z
    .object({ id: z.string().min(1).max(100) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, m.action_failed());
  if (!rateLimit(`chat-open:${user.id}`, OPENS_PER_MINUTE, 60_000)) error(429, m.too_fast());
  const id = await openDirect(user.id, parsed.data.id);
  if (!id) error(403, m.chat_not_friends());
  return json({ id });
};
