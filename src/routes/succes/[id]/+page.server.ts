import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireLogin } from '#lib/server/auth';
import { commentLimit } from '#lib/comments';
import { db } from '#lib/server/db';
import { censor } from '#lib/profanity';
import { renderGuide, renderMarkdown } from '#lib/server/markdown';
import { publicUser } from '#lib/server/queries';
import { ensureGameTexts, localizeAchievements } from '#lib/server/achievement-texts';
import { logger } from '#lib/logger';
import { rateLimit } from '#lib/server/rate-limit';
import { announce } from '#lib/server/indexnow';
import {
  GUIDE_ORDER,
  canEditOfficial,
  checkGuideItem,
  deleteGuide,
  editGuide,
  isBuried,
  voteGuide,
} from '#lib/server/guides';
import { canTranslate, translateContent, translationQuota } from '#lib/server/translate';
import { commentActions, loadComments } from '#lib/server/comments';
import { getLocale } from '#lib/paraglide/runtime';
import type { Actions, PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

const log = logger('Traduction');

/** Les visiteurs ont le filtre : seul un membre peut choisir de le retirer. */
const forViewer = (user: App.Locals['user']) => (text: string, locale: string | null) =>
  user?.allowProfanity ? text : censor(text, locale);

export const load: PageServerLoad = async ({ params, locals, url, depends, setHeaders }) => {
  const timings: string[] = [];
  let startedAt = performance.now();
  const mark = (metric: string) => {
    const now = performance.now();
    timings.push(`${metric};dur=${Math.round(now - startedAt)}`);
    startedAt = now;
  };
  depends('app:sync');
  const viewerId = locals.user?.id;
  const clean = forViewer(locals.user);
  const revealed = url.searchParams.has('caches');
  const achievement = await db.achievement.findUnique({
    where: { id: params.id },
    include: {
      game: {
        select: {
          id: true,
          name: true,
          slug: true,
          adultOnly: true,
          platform: true,
          platformGameId: true,
        },
      },
      unlocks: viewerId ? { where: { userId: viewerId }, select: { unlockedAt: true } } : false,
    },
  });
  if (!achievement || (achievement.game.adultOnly && !locals.user?.showAdult)) {
    error(404, m.achievement_not_found());
  }

  mark('achievement_query');
  const locale = getLocale();
  await ensureGameTexts(achievement.game, locale);
  const [text = achievement] = await localizeAchievements([achievement], locale);
  mark('achievement_texts');
  const translations = { where: { locale }, select: { contentMd: true }, take: 1 };

  /** Traduit d'office ce qui vient d'une autre langue : les textes anciens gardent le bouton seul. */
  const translation = (
    item: {
      locale: string | null;
      authorId: string;
      translations: { contentMd: string }[];
    },
    render = renderMarkdown,
  ) => {
    const autoTranslate =
      canTranslate() &&
      Boolean(item.locale) &&
      item.locale !== locale &&
      item.authorId !== viewerId;
    const cached = autoTranslate ? item.translations[0]?.contentMd : undefined;
    return { autoTranslate, translatedHtml: cached ? render(clean(cached, locale)) : null };
  };

  const [guides, comments, unlockers] = await Promise.all([
    db.guide.findMany({
      where: { achievementId: params.id, status: 'PUBLISHED' },
      orderBy: GUIDE_ORDER,
      include: {
        author: {
          select: publicUser,
        },
        votes: viewerId ? { where: { userId: viewerId }, select: { value: true } } : false,
        checks: viewerId ? { where: { userId: viewerId }, select: { item: true } } : false,
        translations,
      },
    }),
    loadComments({ achievementId: params.id }, locals.user, commentLimit(url)),
    db.userAchievement.count({ where: { achievementId: params.id, user: { isPublic: true } } }),
  ]);

  mark('achievement_related');
  const unlock = achievement.unlocks?.[0]?.unlockedAt ?? null;
  const secret = achievement.hidden && !unlock;
  const masked = secret && !revealed;

  setHeaders({ 'Server-Timing': timings.join(', ') });
  return {
    secret,
    revealed,
    achievement: {
      id: achievement.id,
      name: masked ? m.achievement_hidden() : text.name,
      description: masked ? m.achievement_hidden_text() : text.description,
      iconUrl: masked ? null : achievement.iconUrl,
      trophyType: achievement.trophyType,
      globalRarity: achievement.globalRarity,
      missable: achievement.missable,
      game: { name: achievement.game.name, slug: achievement.game.slug },
    },
    unlockedAt: unlock,
    unlockers,
    canTranslate: canTranslate(),
    canWriteGuide: canWriteGuide(locals.user),
    // Un guide dévoile le succès : il reste caché tant que le succès l'est.
    masked,
    guides: (masked ? [] : guides).map((guide) => ({
      id: guide.id,
      html: renderGuide(clean(guide.contentMd, guide.locale)),
      ...translation(guide, renderGuide),
      official: guide.curatedKey !== null,
      checked: guide.checks?.map((check) => check.item) ?? [],
      score: guide.score,
      // Trop mal noté : replié derrière « voir les guides masqués », jamais supprimé.
      buried: isBuried(guide),
      author: guide.author,
      createdAt: guide.createdAt,
      mine: guide.authorId === viewerId,
      myVote: guide.votes?.[0]?.value ?? 0,
      // Le texte brut d'un guide officiel, pour qu'un modérateur le reprenne sur place.
      source: guide.curatedKey !== null && canEditOfficial(locals.user) ? guide.contentMd : null,
    })),
    comments,
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

const translateSchema = z.object({
  targetType: z.enum(['GUIDE', 'COMMENT']),
  targetId: z.string().min(1),
});

const requireUser = (locals: App.Locals, url: URL) => requireLogin(locals, url.pathname);

const tooFast = (userId: string, action = 'publication') =>
  !rateLimit(`${action}:${userId}`, 5, 60_000);

/** Tout joueur connecté écrit son guide : les votes trient, la modération tranche le reste. */
const canWriteGuide = (user: App.Locals['user']) => Boolean(user);

const checkSchema = z.object({
  guideId: z.string().min(1),
  item: z.coerce.number().int().min(0).max(1_000),
  checked: z.literal('1').optional(),
});

const achievementExists = async (id: string) => (await db.achievement.count({ where: { id } })) > 0;

export const actions: Actions = {
  // La discussion du succès : commenter, réagir, supprimer, traduire et signaler un commentaire.
  ...commentActions(async ({ params }) =>
    params.id && (await achievementExists(params.id)) ? { achievementId: params.id } : null,
  ),

  guide: async ({ request, params, locals, url }) => {
    const user = requireUser(locals, url);
    const form = await request.formData();
    const content = body(20_000).safeParse(form.get('content'));
    if (!content.success) return fail(400, { error: content.error.issues[0]?.message });
    if (tooFast(user.id)) return fail(429, { error: m.too_fast() });
    const target = await db.achievement.findUnique({
      where: { id: params.id },
      select: { hidden: true, game: { select: { adultOnly: true } } },
    });
    if (!target) return fail(404, { error: m.gone() });

    await db.guide.create({
      data: {
        achievementId: params.id,
        authorId: user.id,
        contentMd: content.data,
        locale: getLocale(),
      },
    });
    // Mêmes règles que le plan du site : ni succès caché, ni jeu réservé aux adultes.
    if (!target.hidden && !target.game.adultOnly) announce(`/succes/${params.id}`);
    return { success: m.guide_published() };
  },

  vote: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const form = await request.formData();
    const guideId = String(form.get('guideId'));
    const value = Number(form.get('value')) > 0 ? 1 : -1;
    if (!(await voteGuide(guideId, user.id, value))) return fail(404, { error: m.gone() });
  },

  check: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const parsed = checkSchema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { error: m.action_failed() });
    const { guideId, item, checked } = parsed.data;
    if (!(await checkGuideItem(guideId, user.id, item, Boolean(checked)))) {
      return fail(404, { error: m.gone() });
    }
  },

  /** Un modérateur corrige un guide officiel sur place ; l'import du dépôt garde sa version. */
  editGuide: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    if (!canEditOfficial(user)) return fail(404, { error: m.gone() });
    const form = await request.formData();
    const content = body(20_000).safeParse(form.get('content'));
    if (!content.success) return fail(400, { error: content.error.issues[0]?.message });
    if (!(await editGuide(String(form.get('id')), user, { contentMd: content.data }))) {
      return fail(404, { error: m.gone() });
    }
    return { success: m.guide_updated() };
  },

  deleteGuide: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const id = String((await request.formData()).get('id'));
    await deleteGuide(id, user.id);
    return { success: m.guide_deleted() };
  },

  translate: async ({ request, params, locals, getClientAddress }) => {
    const parsed = translateSchema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success || !canTranslate()) return fail(400, { error: m.translate_failed() });

    const { targetType, targetId } = parsed.data;
    const where = { id: targetId, achievementId: params.id, status: 'PUBLISHED' as const };
    const select = { contentMd: true };
    const source =
      targetType === 'GUIDE'
        ? await db.guide.findFirst({ where, select })
        : await db.comment.findFirst({ where, select });
    if (!source) return fail(404, { error: m.gone() });

    const target = targetType === 'GUIDE' ? { guideId: targetId } : { commentId: targetId };
    try {
      const translated = await translateContent(
        target,
        source.contentMd,
        getLocale(),
        translationQuota({ locals, getClientAddress }),
      );
      if (translated === null) return fail(429, { error: m.translate_failed() });
      const html = targetType === 'GUIDE' ? renderGuide : renderMarkdown;
      return { html: html(forViewer(locals.user)(translated, getLocale())) };
    } catch (cause) {
      log.error('Traduction :', cause);
      return fail(503, { error: m.translate_failed() });
    }
  },

  report: async ({ request, locals, url }) => {
    const user = requireUser(locals, url);
    const parsed = reportSchema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { error: m.report_reason_missing() });
    if (tooFast(user.id, 'signalement')) return fail(429, { error: m.too_fast() });

    const { targetType, targetId } = parsed.data;
    const where = { id: targetId };
    const exists =
      targetType === 'GUIDE' ? await db.guide.count({ where }) : await db.comment.count({ where });
    if (!exists) return fail(404, { error: m.gone() });

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
