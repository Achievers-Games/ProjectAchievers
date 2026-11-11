import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import { editGuide, editableGuides, gameGuidesWhere, guideGame } from '#lib/server/guides';
import { rateLimit } from '#lib/server/rate-limit';
import { announce } from '#lib/server/indexnow';
import { getLocale } from '#lib/paraglide/runtime';
import type { Actions, PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

/** Un guide complet peut être long : une partie par chapitre, des cases pour chaque succès. */
const MAX_LENGTH = 100_000;

const schema = z.object({
  id: z.string().optional(),
  title: z
    .string()
    .trim()
    .min(3, { error: () => m.too_short() })
    .max(120),
  content: z
    .string()
    .trim()
    .min(30, { error: () => m.too_short() })
    .max(MAX_LENGTH),
});

/** L'auteur reprend son guide ; un modérateur reprend aussi les guides officiels. */
async function ownGuide(
  id: string,
  user: { id: string; role: string },
  game: { id: string; familyKey: string | null },
) {
  return db.guide.findFirst({
    where: { AND: [{ id, ...gameGuidesWhere(game) }, editableGuides(user)] },
    select: { id: true, title: true, contentMd: true, curatedKey: true },
  });
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const user = requireLogin(locals, url.pathname + url.search);
  const game = await guideGame(params.slug, locals.user);
  const id = url.searchParams.get('id');
  const guide = id ? await ownGuide(id, user, game) : null;
  if (id && !guide) error(404, m.gone());
  return {
    game: { name: game.name, slug: game.slug },
    maxLength: MAX_LENGTH,
    guide: guide
      ? {
          id: guide.id,
          title: guide.title ?? '',
          content: guide.contentMd,
          official: guide.curatedKey !== null,
        }
      : null,
  };
};

export const actions: Actions = {
  default: async ({ request, params, locals, url }) => {
    const user = requireLogin(locals, url.pathname);
    const game = await guideGame(params.slug, locals.user);
    const form = Object.fromEntries(await request.formData());
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        error: parsed.error.issues[0]?.message ?? m.action_failed(),
        title: String(form.title ?? ''),
        content: String(form.content ?? ''),
      });
    }
    const { id, title, content } = parsed.data;
    if (!rateLimit(`publication:${user.id}`, 5, 60_000)) {
      return fail(429, { error: m.too_fast(), title, content });
    }

    if (id) {
      if (!(await ownGuide(id, user, game))) return fail(404, { error: m.gone() });
      await editGuide(id, user, { title, contentMd: content });
      if (!game.adultOnly) announce(`/jeux/${game.slug}/guides/${id}`);
      redirect(303, `/jeux/${game.slug}/guides/${id}`);
    }
    const guide = await db.guide.create({
      data: { gameId: game.id, authorId: user.id, title, contentMd: content, locale: getLocale() },
    });
    // Un jeu réservé aux adultes reste hors du plan du site : ses guides ne s'annoncent pas.
    if (!game.adultOnly) announce(`/jeux/${game.slug}/guides/${guide.id}`, `/jeux/${game.slug}`);
    redirect(303, `/jeux/${game.slug}/guides/${guide.id}`);
  },
};
