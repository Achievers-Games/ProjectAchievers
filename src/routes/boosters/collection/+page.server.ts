import { fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { requireLogin } from '#lib/server/auth';
import { collectionSummary } from '#lib/server/boosters';
import { resolveCardBanner } from '#lib/server/card-banner';
import { db } from '#lib/server/db';
import { collectionCards, collectionFilters } from './collection.server';
import type { Actions, PageServerLoad } from './$types';

const requireUser = (locals: App.Locals) => requireLogin(locals, '/boosters/collection');

/**
 * La collection reste privée : chacun ne voit que ses propres cartes. Les compteurs viennent de la
 * base, et seule la première page de cartes est chargée : « Afficher plus » lit la suite.
 */
export const load: PageServerLoad = async ({ locals, depends, url }) => {
  depends('app:sync');
  const user = requireUser(locals);
  const filters = collectionFilters(url);
  const [summary, page, profile] = await Promise.all([
    collectionSummary(user.id),
    collectionCards(user.id, { ...filters, cursor: null }),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { bannerEditionId: true } }),
  ]);
  return {
    ...summary,
    ...page,
    filter: { kind: filters.kind, search: filters.search },
    bannerEditionId: profile.bannerEditionId,
  };
};

export const actions: Actions = {
  banner: async ({ locals, request }) => {
    const user = requireUser(locals);
    const editionId = (await request.formData()).get('editionId');
    if (typeof editionId !== 'string') return fail(400, { error: m.action_failed() });
    if (editionId && !(await resolveCardBanner(user.id, editionId))) {
      return fail(403, { error: m.collection_banner_ineligible() });
    }
    await db.user.update({
      where: { id: user.id },
      data: { bannerEditionId: editionId || null },
    });
    return { success: editionId ? m.collection_banner_equipped() : m.collection_banner_removed() };
  },
};
