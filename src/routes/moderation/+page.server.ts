import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';

function requireModerator(locals: App.Locals) {
  if (!locals.user || locals.user.role === 'USER') error(404, m.not_found());
  return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
  requireModerator(locals);

  const reports = await db.report.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: { reporter: { select: { handle: true } } },
  });

  const guideIds = reports.filter((r) => r.targetType === 'GUIDE').map((r) => r.targetId);
  const commentIds = reports.filter((r) => r.targetType === 'COMMENT').map((r) => r.targetId);
  const messageIds = reports.filter((r) => r.targetType === 'MESSAGE').map((r) => r.targetId);
  const [guides, comments, messages] = await Promise.all([
    db.guide.findMany({
      where: { id: { in: guideIds } },
      select: { id: true, contentMd: true, achievementId: true, status: true },
    }),
    db.comment.findMany({
      where: { id: { in: commentIds } },
      select: { id: true, contentMd: true, achievementId: true, status: true },
    }),
    // Seul le message signalé est lu, jamais le reste de la discussion.
    db.message.findMany({
      where: { id: { in: messageIds } },
      select: { id: true, content: true },
    }),
  ]);
  const targets = new Map<string, { contentMd: string; achievementId: string | null }>([
    ...[...guides, ...comments].map((t) => [t.id, t] as const),
    ...messages.map((t) => [t.id, { contentMd: t.content, achievementId: null }] as const),
  ]);

  // Les familles de plusieurs jeux : c'est là que le rapprochement par titre peut se tromper.
  const shared = await db.game.groupBy({
    by: ['familyKey'],
    where: { familyKey: { not: null } },
    _count: { _all: true },
    having: { familyKey: { _count: { gt: 1 } } },
    orderBy: { familyKey: 'asc' },
    take: 200,
  });
  const familyGames = await db.game.findMany({
    where: { familyKey: { in: shared.map((f) => f.familyKey as string) } },
    orderBy: { platform: 'asc' },
    select: { id: true, name: true, slug: true, platform: true, familyKey: true },
  });
  const families = shared.map((family) => ({
    key: family.familyKey as string,
    games: familyGames.filter((game) => game.familyKey === family.familyKey),
  }));

  const feedback = await db.feedback.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      kind: true,
      area: true,
      status: true,
      content: true,
      userAgent: true,
      createdAt: true,
      user: { select: { handle: true, displayName: true } },
    },
  });

  return {
    feedback,
    families,
    reports: reports.map((report) => ({
      id: report.id,
      reason: report.reason,
      reporter: report.reporter.handle,
      targetType: report.targetType,
      createdAt: report.createdAt,
      target: targets.get(report.targetId) ?? null,
    })),
  };
};

const feedbackStatus = z.enum(['NEW', 'PLANNED', 'DONE', 'DECLINED']);

export const actions: Actions = {
  feedback: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const status = feedbackStatus.safeParse(form.get('status'));
    if (!status.success) return fail(400, { error: m.action_failed() });
    await db.feedback.updateMany({
      where: { id: String(form.get('id')) },
      data: { status: status.data },
    });
  },

  separate: async ({ request, locals }) => {
    requireModerator(locals);
    const id = String((await request.formData()).get('id'));
    await db.game.updateMany({
      where: { id },
      data: { familyKey: `seul-${id}`, familyLocked: true },
    });
  },

  join: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const [first, second] = await Promise.all(
      ['first', 'second'].map((name) =>
        db.game.findUnique({ where: { slug: String(form.get(name)).trim() } }),
      ),
    );
    if (!first || !second) return fail(404, { error: m.mod_game_missing() });

    const familyKey = first.familyKey ?? first.id;
    await db.game.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { familyKey, familyLocked: true },
    });
  },

  resolve: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const report = await db.report.findUnique({ where: { id: String(form.get('id')) } });
    if (!report) return fail(404, { error: m.mod_report_missing() });

    await db.$transaction(async (tx) => {
      if (form.get('hide') === '1') {
        if (report.targetType === 'MESSAGE') {
          await tx.message.deleteMany({ where: { id: report.targetId } });
        } else if (report.targetType === 'GUIDE') {
          await tx.guide.updateMany({ where: { id: report.targetId }, data: { status: 'HIDDEN' } });
        } else {
          await tx.comment.updateMany({
            where: { id: report.targetId },
            data: { status: 'HIDDEN' },
          });
        }
      }
      await tx.report.updateMany({
        where: { targetType: report.targetType, targetId: report.targetId, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    });
  },
};
