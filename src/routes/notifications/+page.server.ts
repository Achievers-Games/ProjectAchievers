import { requireLogin } from '#lib/server/auth';
import { notifications, PAGE_NOTICES } from '#lib/server/notifications';
import type { PageServerLoad } from './$types';

/** Toutes les notifications des 30 derniers jours, pas seulement celles que la cloche affiche. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:notices');
  const user = requireLogin(locals, '/notifications');
  return { items: await notifications(user.id, PAGE_NOTICES) };
};
