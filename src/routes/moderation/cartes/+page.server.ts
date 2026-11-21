import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { m } from '#lib/paraglide/messages';
import { CARD_PLAN_VIEWS, cardPlan, saveCardPlan, type CardPlanView } from '#lib/server/card-plan';
import { db } from '#lib/server/db';
import { requireModerator } from '#lib/server/moderator';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireModerator(locals);
  const asked = url.searchParams.get('vue');
  const view: CardPlanView = CARD_PLAN_VIEWS.includes(asked as CardPlanView)
    ? (asked as CardPlanView)
    : 'a-faire';
  const search = url.searchParams.get('q')?.trim().slice(0, 80) ?? '';
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  return { view, search, page, ...(await cardPlan(view, search, page)) };
};

const planForm = z.object({
  familyKey: z.string().min(1).max(200),
  // Une adresse https, ou rien pour effacer le choix.
  mythiqueArtUrl: z.union([
    z.literal(''),
    z.string().trim().url().startsWith('https://').max(1000),
  ]),
  note: z.string().trim().max(500),
});

export const actions: Actions = {
  plan: async ({ locals, request }) => {
    requireModerator(locals);
    const parsed = planForm.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { error: m.mod_cards_invalid_url() });
    const { familyKey, mythiqueArtUrl, note } = parsed.data;
    const known = await db.game.findFirst({ where: { familyKey }, select: { id: true } });
    if (!known) return fail(404, { error: m.action_failed() });
    await saveCardPlan(familyKey, mythiqueArtUrl || null, note || null);
    return { saved: familyKey };
  },
};
