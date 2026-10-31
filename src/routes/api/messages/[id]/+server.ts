import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { rateLimit } from '$lib/server/rate-limit';
import { markRead, readConversation, sendMessage } from '$lib/server/social';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';

const MESSAGES_PER_MINUTE = 20;

const body = z.object({ content: z.string().trim().min(1).max(2_000) });

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) error(401, m.login_required());
  const conversation = await readConversation(locals.user.id, params.id);
  if (!conversation) error(404, m.gone());
  return json(conversation);
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, m.too_short());
  if (!rateLimit(`message:${user.id}`, MESSAGES_PER_MINUTE, 60_000)) error(429, m.too_fast());

  const message = await sendMessage(user.id, params.id, parsed.data.content);
  if (message === 'not_friends') error(403, m.chat_not_friends());
  if (typeof message === 'string') error(404, m.gone());
  return json(message);
};

/** Le message reçu pendant que la discussion est ouverte est déjà lu. */
export const PUT: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) error(401, m.login_required());
  await markRead(locals.user.id, params.id);
  return new Response(null, { status: 204 });
};
