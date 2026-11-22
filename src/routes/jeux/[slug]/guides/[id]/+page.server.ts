import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireLogin } from '#lib/server/auth';
import { commentLimit } from '#lib/comments';
import { db } from '#lib/server/db';
import { censor } from '#lib/profanity';
import { guideLinks } from '#lib/server/guide-links';
import { renderGuide } from '#lib/server/markdown';
import { publicUser } from '#lib/server/queries';
import {
  canEditOfficial,
  checkGuideItem,
  countChecklist,
  deleteGuide,
  gameGuidesWhere,
  guideGame,
  isBuried,
  reportGuide,
  voteGuide,
} from '#lib/server/guides';
import { rateLimit } from '#lib/server/rate-limit';
import { canTranslate, translateContent, translationQuota } from '#lib/server/translate';
import { anchorHeadings } from '#lib/guide-outline';
import { excerpt } from '#lib/seo';
import { commentActions, loadComments } from '#lib/server/comments';
import { logger } from '#lib/logger';
import { getLocale } from '#lib/paraglide/runtime';
import type { Actions, PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

const log = logger('Traduction');

/** Les visiteurs ont le filtre : seul un membre peut choisir de le retirer. */
const forViewer = (user: App.Locals['user']) => (text: string, locale: string | null) =>
  user?.allowProfanity ? text : censor(text, locale);

/**
 * Le rendu d'un texte du guide. Le sommaire s'appuie sur les parties numérotées : l'original et la
 * traduction les gardent. Un guide officiel mène aussi à la page de chaque succès qu'il nomme.
 */
async function renderer(
  game: Awaited<ReturnType<typeof guideGame>>,
  guide: { curatedKey: string | null; contentMd: string },
) {
  const link = guide.curatedKey === null ? null : await guideLinks(game, getLocale());
  return (text: string) => {
    const html = renderGuide(text);
    return anchorHeadings(link ? link(html, guide.contentMd) : html);
  };
}

/** Le guide doit appartenir à une version de ce jeu : une autre adresse ne l'ouvre pas. */
async function findGuide(slug: string, id: string, locals: App.Locals) {
  const game = await guideGame(slug, locals.user);
  const guide = await db.guide.count({ where: { id, ...gameGuidesWhere(game) } });
  if (!guide) error(404, m.gone());
  return game;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const viewerId = locals.user?.id;
  const clean = forViewer(locals.user);
  const game = await guideGame(params.slug, locals.user);
  const locale = getLocale();
  const guide = await db.guide.findFirst({
    where: { id: params.id, ...gameGuidesWhere(game) },
    include: {
      author: { select: publicUser },
      game: { select: { slug: true } },
      votes: viewerId ? { where: { userId: viewerId }, select: { value: true } } : false,
      checks: viewerId ? { where: { userId: viewerId }, select: { item: true } } : false,
      translations: { where: { locale }, select: { contentMd: true }, take: 1 },
    },
  });
  if (!guide) error(404, m.gone());

  // Traduit d'office ce qui vient d'une autre langue, sauf pour son auteur.
  const foreign =
    canTranslate() &&
    Boolean(guide.locale) &&
    guide.locale !== locale &&
    guide.authorId !== viewerId;
  const cached = foreign ? guide.translations[0]?.contentMd : undefined;
  // La traduction déjà faite est servie à tous ; seul un membre en demande une d'office : les
  // robots qui exécutent le JS épuisaient le quota de traduction.
  const autoTranslate = foreign && Boolean(viewerId);

  const [render, comments] = await Promise.all([
    renderer(game, guide),
    loadComments({ guideId: guide.id }, locals.user, commentLimit(url)),
  ]);

  return {
    game: { name: game.name, slug: game.slug },
    // Le guide vaut pour toutes les versions du jeu : une seule adresse à indexer, la sienne.
    canonicalPath: `/jeux/${guide.game?.slug ?? game.slug}/guides/${guide.id}`,
    canTranslate: canTranslate(),
    comments,
    guide: {
      id: guide.id,
      title: clean(guide.title ?? '', guide.locale),
      html: render(clean(guide.contentMd, guide.locale)),
      excerpt: excerpt(clean(guide.contentMd, guide.locale)),
      autoTranslate,
      translatedHtml: cached ? render(clean(cached, locale)) : null,
      official: guide.curatedKey !== null,
      buried: isBuried(guide),
      score: guide.score,
      myVote: guide.votes?.[0]?.value ?? 0,
      checked: guide.checks?.map((check) => check.item) ?? [],
      steps: countChecklist(guide.contentMd),
      author: guide.author,
      createdAt: guide.createdAt,
      updatedAt: guide.updatedAt,
      mine: guide.authorId === viewerId,
    },
    // Un modérateur reprend le guide officiel depuis le site, sans passer par le dépôt.
    canEditOfficial: guide.curatedKey !== null && canEditOfficial(locals.user),
  };
};

const checkSchema = z.object({
  item: z.coerce.number().int().min(0).max(5_000),
  checked: z.literal('1').optional(),
});

const reasonSchema = z.string().trim().min(3).max(500);

export const actions: Actions = {
  // La discussion du guide : commenter, réagir, supprimer, traduire et signaler un commentaire.
  ...commentActions(async ({ params, locals }) => {
    if (!params.slug || !params.id) return null;
    const game = await guideGame(params.slug, locals.user);
    const exists = await db.guide.count({ where: { id: params.id, ...gameGuidesWhere(game) } });
    return exists ? { guideId: params.id } : null;
  }),

  vote: async ({ request, params, locals, url }) => {
    const user = requireLogin(locals, url.pathname);
    await findGuide(params.slug, params.id, locals);
    const value = Number((await request.formData()).get('value')) > 0 ? 1 : -1;
    const result = await voteGuide(params.id, user.id, value);
    if (!result) return fail(404, { error: m.gone() });
    return result;
  },

  check: async ({ request, params, locals, url }) => {
    const user = requireLogin(locals, url.pathname);
    const parsed = checkSchema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { error: m.action_failed() });
    await findGuide(params.slug, params.id, locals);
    const { item, checked } = parsed.data;
    if (!(await checkGuideItem(params.id, user.id, item, Boolean(checked)))) {
      return fail(404, { error: m.gone() });
    }
  },

  report: async ({ request, params, locals, url }) => {
    const user = requireLogin(locals, url.pathname);
    const reason = reasonSchema.safeParse((await request.formData()).get('reason'));
    if (!reason.success) return fail(400, { error: m.report_reason_missing() });
    if (!rateLimit(`signalement:${user.id}`, 5, 60_000)) return fail(429, { error: m.too_fast() });
    await findGuide(params.slug, params.id, locals);
    await reportGuide(params.id, user.id, reason.data);
    return { success: m.report_sent() };
  },

  delete: async ({ params, locals, url }) => {
    const user = requireLogin(locals, url.pathname);
    await findGuide(params.slug, params.id, locals);
    if (!(await deleteGuide(params.id, user.id))) return fail(404, { error: m.gone() });
    redirect(303, `/jeux/${params.slug}`);
  },

  translate: async ({ params, locals, getClientAddress }) => {
    if (!canTranslate()) return fail(400, { error: m.translate_failed() });
    const game = await guideGame(params.slug, locals.user);
    const source = await db.guide.findFirst({
      where: { id: params.id, ...gameGuidesWhere(game) },
      select: { contentMd: true, curatedKey: true },
    });
    if (!source) return fail(404, { error: m.gone() });
    try {
      const translated = await translateContent(
        { guideId: params.id },
        source.contentMd,
        getLocale(),
        translationQuota({ locals, getClientAddress }),
      );
      if (translated === null) return fail(429, { error: m.translate_failed() });
      const render = await renderer(game, source);
      return { html: render(forViewer(locals.user)(translated, getLocale())) };
    } catch (cause) {
      log.error('Traduction :', cause);
      return fail(503, { error: m.translate_failed() });
    }
  },
};
