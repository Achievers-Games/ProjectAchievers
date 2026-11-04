import { pushPublicKey } from '#lib/server/push';
import { themeOf } from '#lib/theme';
import { pendingInvites, unreadCount } from '#lib/server/social';
import { unseenNotices } from '#lib/server/notifications';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies, depends }) => {
  depends('app:invites');
  depends('app:notices');
  return {
    unread: locals.user ? await unreadCount(locals.user.id) : 0,
    invites: locals.user ? await pendingInvites(locals.user.id) : { friends: 0, clans: 0 },
    notices: { unseen: locals.user ? await unseenNotices(locals.user.id) : 0 },
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
