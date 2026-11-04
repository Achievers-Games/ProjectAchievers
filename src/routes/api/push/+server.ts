import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db';
import { isPushEndpoint } from '#lib/server/push';
import { getLocale } from '#lib/paraglide/runtime';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

const endpoint = z.url().max(1_000).refine(isPushEndpoint);

const subscription = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  const parsed = subscription.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, m.action_failed());

  const data = {
    userId: user.id,
    sessionId: user.sessionId,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    locale: getLocale(),
  };
  await db.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: data,
    create: { ...data, endpoint: parsed.data.endpoint },
  });
  return new Response(null, { status: 204 });
};

const preferences = z.object({
  messages: z.boolean(),
  invites: z.boolean(),
  events: z.boolean(),
});

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  const parsed = preferences.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, m.action_failed());
  await db.user.update({
    where: { id: user.id },
    data: {
      pushMessages: parsed.data.messages,
      pushInvites: parsed.data.invites,
      pushEvents: parsed.data.events,
    },
  });
  return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  const parsed = z.object({ endpoint }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, m.action_failed());
  await db.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: user.id },
  });
  return new Response(null, { status: 204 });
};
