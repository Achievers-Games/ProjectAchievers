import { fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { requireLogin } from '#lib/server/auth';
import { userCollection } from '#lib/server/boosters';
import { bannerProgress, resolveCardBanner } from '#lib/server/card-banner';
import { db } from '#lib/server/db';
import type { Actions, PageServerLoad } from './$types';

const requireUser = (locals: App.Locals) => requireLogin(locals, '/boosters/collection');

/** La collection reste privée : chacun ne voit que ses propres cartes. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:sync');
  const user = requireUser(locals);
  const [collection, profile] = await Promise.all([
    userCollection(user.id),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { bannerEditionId: true } }),
  ]);
  const progress = await bannerProgress(
    user.id,
    collection.cards.map((card) => card.familyKey),
  );
  return {
    ...collection,
    bannerEditionId: profile.bannerEditionId,
    cards: collection.cards.map((card) => ({
      ...card,
      bannerCompletion: card.enabled ? (progress.get(card.familyKey) ?? null) : null,
    })),
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
