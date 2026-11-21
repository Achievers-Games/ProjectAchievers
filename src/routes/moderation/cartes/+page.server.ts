import { CARD_PLAN_VIEWS, cardPlan, type CardPlanView } from '#lib/server/card-plan';
import { requireModerator } from '#lib/server/moderator';
import type { PageServerLoad } from './$types';

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
