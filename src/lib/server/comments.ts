import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import type { ReactionType } from '#prisma';
import { COMMENTS_STEP } from '#lib/comments';
import { censor } from '#lib/profanity';
import { logger } from '#lib/logger';
import { m } from '#lib/paraglide/messages';
import { getLocale } from '#lib/paraglide/runtime';
import { requireLogin } from './auth';
import { db } from './db';
import { renderMarkdown } from './markdown';
import { publicUser } from './queries/shared';
import { rateLimit } from './rate-limit';
import { canTranslate, translateContent, translationQuota } from './translate';

/**
 * La discussion d'une page : sous un succès, un guide de jeu ou un profil. Le chargement et
 * les actions sont les mêmes partout ; seule change la chose commentée.
 */
export type CommentTarget =
  | { achievementId: string }
  | { guideId: string }
  | { profileId: string }
  | { unlockOwnerId: string; unlockAchievementId: string };

function visibleCommentAuthor(target: CommentTarget, viewerId: string | undefined) {
  if ((!('profileId' in target) && !('unlockOwnerId' in target)) || !viewerId) return {};
  return {
    author: {
      blocks: { none: { blockedId: viewerId } },
      blockedBy: { none: { blockerId: viewerId } },
    },
  };
}

const log = logger('Discussion');

/** Les visiteurs ont le filtre : seul un membre peut choisir de le retirer. */
const forViewer = (user: App.Locals['user']) => (text: string, locale: string | null) =>
  user?.allowProfanity ? text : censor(text, locale);

/** Les commentaires d'une page et leurs réponses, prêts à afficher pour ce lecteur. */
/**
 * Rend un commentaire de plus que `limit` quand il en reste : la page sait ainsi, sans second
 * comptage, qu'elle doit proposer « Afficher plus ».
 */
export async function loadComments(
  target: CommentTarget,
  user: App.Locals['user'],
  limit = COMMENTS_STEP,
) {
  const viewerId = user?.id;
  const author = visibleCommentAuthor(target, viewerId);
  const clean = forViewer(user);
  const locale = getLocale();
  const translations = { where: { locale }, select: { contentMd: true }, take: 1 };
  const entry = {
    author: { select: publicUser },
    reactions: { select: { userId: true, type: true } },
    translations,
  };

  const comments = await db.comment.findMany({
    where: { ...target, ...author, parentId: null, status: { not: 'HIDDEN' } },
    orderBy: { createdAt: 'asc' },
    take: limit + 1,
    include: {
      ...entry,
      replies: {
        where: { ...author, status: { not: 'HIDDEN' } },
        orderBy: { createdAt: 'asc' },
        include: entry,
      },
    },
  });

  type Raw = Omit<(typeof comments)[number], 'replies'>;
  const view = (comment: Raw) => {
    const counts: Partial<Record<ReactionType, number>> = {};
    for (const reaction of comment.reactions) {
      counts[reaction.type] = (counts[reaction.type] ?? 0) + 1;
    }
    // Traduit d'office ce qui vient d'une autre langue : les textes anciens gardent le bouton seul.
    const foreign =
      canTranslate() &&
      Boolean(comment.locale) &&
      comment.locale !== locale &&
      comment.authorId !== viewerId;
    const cached = foreign ? comment.translations[0]?.contentMd : undefined;
    return {
      id: comment.id,
      createdAt: comment.createdAt,
      html: renderMarkdown(clean(comment.contentMd, comment.locale)),
      // La traduction déjà faite est servie à tous ; seul un membre en demande une d'office : les
      // robots qui exécutent le JS épuisaient le quota de traduction.
      autoTranslate: foreign && Boolean(viewerId),
      translatedHtml: cached ? renderMarkdown(clean(cached, locale)) : null,
      author: comment.author,
      mine: comment.authorId === viewerId,
      counts,
      myReaction: comment.reactions.find((reaction) => reaction.userId === viewerId)?.type ?? null,
    };
  };
  return comments.map((comment) => ({ ...view(comment), replies: comment.replies.map(view) }));
}

export type CommentView = Awaited<ReturnType<typeof loadComments>>[number];

const content = z
  .string()
  .trim()
  .min(3, { error: () => m.too_short() })
  .max(2_000);

const reactionSchema = z.object({
  commentId: z.string().min(1),
  type: z.enum(['HELPFUL', 'THANKS', 'FUNNY']),
});

const reasonSchema = z.string().trim().min(3).max(500);

const requireUser = (event: RequestEvent) => requireLogin(event.locals, event.url.pathname);

/**
 * Les actions de formulaire d'une discussion, à étaler dans celles d'une page. `target` dit ce
 * que la page commente, ou `null` si la chose a disparu entre-temps.
 */
export function commentActions(target: (event: RequestEvent) => Promise<CommentTarget | null>) {
  return {
    comment: async (event: RequestEvent) => {
      const user = requireUser(event);
      const form = await event.request.formData();
      const text = content.safeParse(form.get('content'));
      if (!text.success) return fail(400, { error: text.error.issues[0]?.message });
      if (!rateLimit(`publication:${user.id}`, 5, 60_000))
        return fail(429, { error: m.too_fast() });
      const on = await target(event);
      if (!on) return fail(404, { error: m.gone() });

      // Les réponses restent à un seul niveau, et sous la même page : plus lisible sur mobile.
      const parentId = form.get('parentId');
      const parent =
        typeof parentId === 'string' && parentId
          ? await db.comment.findFirst({
              where: {
                id: parentId,
                ...on,
                ...visibleCommentAuthor(on, user.id),
                parentId: null,
                status: 'PUBLISHED',
              },
              select: { id: true },
            })
          : null;
      if (parentId && !parent) return fail(404, { error: m.gone() });

      await db.comment.create({
        data: {
          ...on,
          authorId: user.id,
          contentMd: text.data,
          locale: getLocale(),
          parentId: parent?.id,
        },
      });
      return { success: m.comment_published() };
    },

    react: async (event: RequestEvent) => {
      const user = requireUser(event);
      const parsed = reactionSchema.safeParse(Object.fromEntries(await event.request.formData()));
      if (!parsed.success) return fail(400, { error: m.reaction_invalid() });
      const on = await target(event);
      if (!on) return fail(404, { error: m.gone() });
      const exists = await db.comment.count({
        where: {
          id: parsed.data.commentId,
          ...on,
          ...visibleCommentAuthor(on, user.id),
          status: 'PUBLISHED',
        },
      });
      if (!exists) return fail(404, { error: m.gone() });

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

    deleteComment: async (event: RequestEvent) => {
      const user = requireUser(event);
      const id = String((await event.request.formData()).get('id'));
      const on = await target(event);
      if (!on) return fail(404, { error: m.gone() });
      const own = await db.comment.count({ where: { id, ...on, authorId: user.id } });
      if (!own) return fail(404, { error: m.gone() });

      // Rien n'est gardé ; les réponses des autres survivent en remontant d'un niveau.
      await db.$transaction([
        db.comment.updateMany({ where: { parentId: id }, data: { parentId: null } }),
        db.report.deleteMany({ where: { targetType: 'COMMENT', targetId: id } }),
        db.comment.delete({ where: { id } }),
      ]);
      return { success: m.comment_deleted() };
    },

    translateComment: async (event: RequestEvent) => {
      const id = String((await event.request.formData()).get('id') ?? '');
      if (!id || !canTranslate()) return fail(400, { error: m.translate_failed() });
      const on = await target(event);
      const source = on
        ? await db.comment.findFirst({
            where: {
              id,
              ...on,
              ...visibleCommentAuthor(on, event.locals.user?.id),
              status: 'PUBLISHED',
            },
            select: { contentMd: true },
          })
        : null;
      if (!source) return fail(404, { error: m.gone() });
      try {
        const translated = await translateContent(
          { commentId: id },
          source.contentMd,
          getLocale(),
          translationQuota(event),
        );
        if (translated === null) return fail(429, { error: m.translate_failed() });
        return { html: renderMarkdown(forViewer(event.locals.user)(translated, getLocale())) };
      } catch (cause) {
        log.error('Traduction :', cause);
        return fail(503, { error: m.translate_failed() });
      }
    },

    reportComment: async (event: RequestEvent) => {
      const user = requireUser(event);
      const form = await event.request.formData();
      const id = String(form.get('id') ?? '');
      const reason = reasonSchema.safeParse(form.get('reason'));
      if (!reason.success) return fail(400, { error: m.report_reason_missing() });
      if (!rateLimit(`signalement:${user.id}`, 5, 60_000))
        return fail(429, { error: m.too_fast() });
      const on = await target(event);
      if (!on) return fail(404, { error: m.gone() });
      const exists = await db.comment.count({
        where: { id, ...on, ...visibleCommentAuthor(on, user.id), status: 'PUBLISHED' },
      });
      if (!exists) return fail(404, { error: m.gone() });

      await db.report.upsert({
        where: {
          reporterId_targetType_targetId: {
            reporterId: user.id,
            targetType: 'COMMENT',
            targetId: id,
          },
        },
        update: { reason: reason.data },
        create: { targetType: 'COMMENT', targetId: id, reason: reason.data, reporterId: user.id },
      });
      return { success: m.report_sent() };
    },
  };
}
