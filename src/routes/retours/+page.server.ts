import { fail } from '@sveltejs/kit';
import { FeedbackArea } from '@prisma/client';
import { z } from 'zod';
import { feedbackAreaLabel } from '$lib/feedback';
import { requireLogin } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { notify } from '$lib/server/push';
import { rateLimit } from '$lib/server/rate-limit';
import { m } from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const PER_HOUR = 5;

const requireUser = (locals: App.Locals) => requireLogin(locals, '/retours');

const feedback = z.object({
  kind: z.enum(['BUG', 'IDEA']),
  area: z.enum(FeedbackArea),
  content: z
    .string()
    .trim()
    .min(10, { error: () => m.too_short() })
    .max(4_000),
});

export const load: PageServerLoad = async ({ locals }) => ({
  sent: await db.feedback.findMany({
    where: { userId: requireUser(locals).id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, kind: true, area: true, status: true, content: true, createdAt: true },
  }),
});

export const actions: Actions = {
  send: async ({ request, locals }) => {
    const user = requireUser(locals);
    const parsed = feedback.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message });
    if (!rateLimit(`retour:${user.id}`, PER_HOUR, 3_600_000)) {
      return fail(429, { error: m.too_fast() });
    }

    const created = await db.feedback.create({
      data: {
        ...parsed.data,
        userId: user.id,
        userAgent: request.headers.get('user-agent')?.slice(0, 255),
      },
    });
    const admins = await db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    for (const admin of admins) {
      notify(admin.id, 'event', `retour:${created.id}`, (locale) => ({
        title:
          parsed.data.kind === 'BUG'
            ? m.feedback_bug({}, { locale })
            : m.feedback_idea({}, { locale }),
        body: `${feedbackAreaLabel(parsed.data.area)} · ${user.displayName} : ${parsed.data.content.slice(0, 100)}`,
        url: '/moderation',
      }));
    }
    return { success: m.feedback_sent() };
  },
};
