import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { rateLimit } from '#lib/server/rate-limit';
import { reportMessage } from '#lib/server/social';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

const body = z.object({
  messageId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, m.report_reason_missing());
  if (!rateLimit(`signalement:${user.id}`, 5, 60_000)) error(429, m.too_fast());
  if (!(await reportMessage(user.id, parsed.data.messageId, parsed.data.reason))) {
    error(404, m.gone());
  }
  return json({ ok: true });
};
