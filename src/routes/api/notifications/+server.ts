import { error, json } from '@sveltejs/kit';
import { notifications, markNotificationsRead, unseenNotices } from '#lib/server/notifications';
import { pendingInvites, unreadCount } from '#lib/server/social';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

/** Le panneau se lit d'un coup d'œil : une douzaine de lignes suffit, le reste est déjà sur sa page. */
export const GET: RequestHandler = async ({ locals }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  const [items, messages, invites, unseen] = await Promise.all([
    notifications(user.id),
    unreadCount(user.id),
    pendingInvites(user.id),
    unseenNotices(user.id),
  ]);
  return json({ items, unread: messages + invites.friends + invites.clans + unseen });
};

/** « Tout marquer comme lu » : le badge de la cloche retombe à zéro. */
export const PUT: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());
  await markNotificationsRead(locals.user.id);
  return new Response(null, { status: 204 });
};
