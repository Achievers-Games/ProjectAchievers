import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

function requireModerator(locals: App.Locals) {
  if (!locals.user || locals.user.role === 'USER') error(404, 'Page introuvable');
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
  const [guides, comments] = await Promise.all([
    db.guide.findMany({
      where: { id: { in: guideIds } },
      select: { id: true, contentMd: true, achievementId: true, status: true },
    }),
    db.comment.findMany({
      where: { id: { in: commentIds } },
      select: { id: true, contentMd: true, achievementId: true, status: true },
    }),
  ]);
  const targets = new Map([...guides, ...comments].map((t) => [t.id, t]));

  return {
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

export const actions: Actions = {
  resolve: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const report = await db.report.findUnique({ where: { id: String(form.get('id')) } });
    if (!report) return fail(404, { error: 'Signalement introuvable.' });

    await db.$transaction(async (tx) => {
      if (form.get('hide') === '1') {
        if (report.targetType === 'GUIDE') {
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
