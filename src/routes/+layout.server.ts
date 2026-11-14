import { db } from '#lib/server/db';
import { pushPublicKey } from '#lib/server/push';
import { themeOf } from '#lib/theme';
import { pendingInvites, unreadCount } from '#lib/server/social';
import { unseenNotices } from '#lib/server/notifications';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies, depends }) => {
  depends('app:sync');
  depends('app:invites');
  depends('app:notices');
  const [unread, invites, unseen, steamPrivate] = locals.user
    ? await Promise.all([
        unreadCount(locals.user.id),
        pendingInvites(locals.user.id),
        unseenNotices(locals.user.id),
        // Steam cache des jeux à ce joueur : le site le lui dit, où qu'il soit.
        db.linkedAccount.count({
          where: { userId: locals.user.id, provider: 'STEAM', playtimeHidden: true },
        }),
      ])
    : [0, { friends: 0, clans: 0 }, 0, 0];
  return {
    unread,
    invites,
    notices: { unseen },
    steamPlaytimePrivate: steamPrivate > 0,
    pushKey: pushPublicKey(),
    user: locals.user && {
      id: locals.user.id,
      handle: locals.user.handle,
      displayName: locals.user.displayName,
      timeZone: locals.user.timeZone,
      avatarUrl: locals.user.avatarUrl,
      avatarMotionUrl: locals.user.avatarMotionUrl,
      frame: locals.user.frame,
      frameMotionUrl: locals.user.frameMotionUrl,
      role: locals.user.role,
      allowProfanity: locals.user.allowProfanity,
    },
    theme: themeOf(cookies.get('pa_theme')),
  };
};
