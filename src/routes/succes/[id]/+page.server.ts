import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { ReactionType } from '@prisma/client';
import { db } from '$lib/server/db';
import { renderMarkdown } from '$lib/server/markdown';
import { rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals }) => {
  const viewerId = locals.user?.id;
  const achievement = await db.achievement.findUnique({
    where: { id: params.id },
    include: {
      game: { select: { name: true, slug: true, adultOnly: true } },
      unlocks: viewerId ? { where: { userId: viewerId }, select: { unlockedAt: true } } : false,
    },
  });
  if (!achievement || (achievement.game.adultOnly && !locals.user?.showAdult)) {
    error(404, m.achievement_not_found());
  }

  const [guides, comments, unlockers] = await Promise.all([
    db.guide.findMany({
      where: { achievementId: params.id, status: 'PUBLISHED' },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      include: {
        author: { select: { handle: true, displayName: true, avatarUrl: true } },
        votes: viewerId ? { where: { userId: viewerId }, select: { value: true } } : false,
      },
    }),
    db.comment.findMany({
      where: { achievementId: params.id, parentId: null, status: { not: 'HIDDEN' } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        author: { select: { handle: true, displayName: true, avatarUrl: true } },
        reactions: { select: { userId: true, type: true } },
        replies: {
          where: { status: { not: 'HIDDEN' } },
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { handle: true, displayName: true, avatarUrl: true } },
            reactions: { select: { userId: true, type: true } },
          },
        },
      },
    }),
    db.userAchievement.count({ where: { achievementId: params.id, user: { isPublic: true } } }),
  ]);

  type RawComment = Omit<(typeof comments)[number], 'replies'>;
  const view = (comment: RawComment) => {
    const deleted = comment.status === 'DELETED';
    const counts: Partial<Record<ReactionType, number>> = {};
    for (const r of comment.reactions) counts[r.type] = (counts[r.type] ?? 0) + 1;
    return {
      id: comment.id,
      createdAt: comment.createdAt,
      deleted,
      html: deleted ? '' : renderMarkdown(comment.contentMd),
      author: comment.author,
      mine: comment.authorId === viewerId,
      counts,
      myReaction: comment.reactions.find((r) => r.userId === viewerId)?.type ?? null,
    };
  };

  const unlock = achievement.unlocks?.[0]?.unlockedAt ?? null;
  const masked = achievement.hidden && !unlock;

  return {
    achievement: {
      id: achievement.id,
      name: masked ? m.achievement_hidden() : achievement.name,
      description: masked ? m.achievement_hidden_text() : achievement.description,
      iconUrl: masked ? null : achievement.iconUrl,
      trophyType: achievement.trophyType,
      globalRarity: achievement.globalRarity,
      points: achievement.points,
      game: { name: achievement.game.name, slug: achievement.game.slug },
    },
    unlockedAt: unlock,
    unlockers,
    guides: guides.map((guide) => ({
      id: guide.id,
      html: renderMarkdown(guide.contentMd),
      score: guide.score,
      author: guide.author,
      createdAt: guide.createdAt,
      mine: guide.authorId === viewerId,
      myVote: guide.votes?.[0]?.value ?? 0,
    })),
    comments: comments.map((comment) => ({ ...view(comment), replies: comment.replies.map(view) })),
  };
};

const body = (max: number) =>
  z
    .string()
    .trim()
    .min(3, { error: () => m.too_short() })
    .max(max);

const reportSchema = z.object({
  targetType: z.enum(['GUIDE', 'COMMENT']),
  targetId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

const reactionSchema = z.object({
  commentId: z.string().min(1),
  type: z.enum(['HELPFUL', 'THANKS', 'FUNNY']),
});

function requireUser(locals: App.Locals, url: URL) {
  if (!locals.user) redirect(303, `/connexion?retour=${encodeURIComponent(url.pathname)}`);
  return locals.user;
}

const tooFast = (userId: string) => !rateLimit(`publication:${userId}`, 5, 60_000);

const achievementExists = async (id: string) => (await db.achievement.count({ where: { id } })) > 0;

export const actions: Actions = {
  guide: async ({ request, params, locals, url }) => {
    const user = requireUser(locals, url);
    const form = await request.formData();
    const content = body(20_000).safeParse(form.get('content'));
    if (!content.success) return fail(400, { error: content.error.issues[0]?.message });
    if (tooFast(user.id)) return fail(429, { error: m.too_fast() });
    if (!(await achievementExists(params.id))) return fail(404, { error: m.gone() });

    await db.guide.create({
      data: { achievementId: params.id, authorId: user.id, contentMd: content.data },
    });
    return { success: m.guide_published() };
  },

  vote: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const form = await request.formData();
    const guideId = String(form.get('guideId'));
    const value = Number(form.get('value')) > 0 ? 1 : -1;
    const guide = await db.guide.count({ where: { id: guideId, status: 'PUBLISHED' } });
    if (!guide) return fail(404, { error: m.gone() });

    await db.$transaction(async (tx) => {
      const key = { guideId_userId: { guideId, userId: user.id } };
      const current = await tx.guideVote.findUnique({ where: key });
      if (current?.value === value) await tx.guideVote.delete({ where: key });
      else {
        await tx.guideVote.upsert({
          where: key,
          update: { value },
          create: { guideId, userId: user.id, value },
        });
      }
      const { _sum } = await tx.guideVote.aggregate({ where: { guideId }, _sum: { value: true } });
      await tx.guide.update({ where: { id: guideId }, data: { score: _sum.value ?? 0 } });
    });
  },

  comment: async ({ request, params, locals, url }) => {
    const user = requireUser(locals, url);
    const form = await request.formData();
    const content = body(2_000).safeParse(form.get('content'));
    if (!content.success) return fail(400, { error: content.error.issues[0]?.message });
    if (tooFast(user.id)) return fail(429, { error: m.too_fast() });
    if (!(await achievementExists(params.id))) return fail(404, { error: m.gone() });

    // Les réponses restent à un seul niveau : plus lisible sur mobile.
    const parentId = form.get('parentId');
    const parent =
      typeof parentId === 'string' && parentId
        ? await db.comment.findFirst({
            where: { id: parentId, achievementId: params.id, parentId: null },
            select: { id: true },
          })
        : null;

    await db.comment.create({
      data: {
        achievementId: params.id,
        authorId: user.id,
        contentMd: content.data,
        parentId: parent?.id,
      },
    });
    return { success: m.comment_published() };
  },

  react: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const parsed = reactionSchema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { error: m.reaction_invalid() });
    const comment = await db.comment.count({
      where: { id: parsed.data.commentId, status: 'PUBLISHED' },
    });
    if (!comment) return fail(404, { error: m.gone() });

    const key = { commentId_userId: { commentId: parsed.data.commentId, userId: user.id } };
    const current = await db.commentReaction.findUnique({ where: key });
    if (current?.type === parsed.data.type) await db.commentReaction.delete({ where: key });
    else {
      await db.commentReaction.upsert({
        where: key,
        update: { type: parsed.data.type },
        create: { ...parsed.data, userId: user.id },
      });
    }
  },

  deleteComment: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const id = String((await request.formData()).get('id'));
    // Le contenu est retiré, la ligne reste pour garder le fil des réponses.
    await db.comment.updateMany({
      where: { id, authorId: user.id },
      data: { status: 'DELETED', contentMd: '' },
    });
    return { success: m.comment_deleted() };
  },

  deleteGuide: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const id = String((await request.formData()).get('id'));
    await db.guide.updateMany({
      where: { id, authorId: user.id },
      data: { status: 'DELETED', contentMd: '' },
    });
    return { success: m.guide_deleted() };
  },

  report: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const parsed = reportSchema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { error: m.report_reason_missing() });

    await db.report.upsert({
      where: {
        reporterId_targetType_targetId: {
          reporterId: user.id,
          targetType: parsed.data.targetType,
          targetId: parsed.data.targetId,
        },
      },
      update: { reason: parsed.data.reason },
      create: { ...parsed.data, reporterId: user.id },
    });
    return { success: m.report_sent() };
  },
};
