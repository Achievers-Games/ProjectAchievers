import { db } from '#lib/server/db';
import { pushPublicKey } from '#lib/server/push';
import { themeOf } from '#lib/theme';
import { pendingInvites, unreadCount } from '#lib/server/social';
import { unseenNotices } from '#lib/server/notifications';
import { steamPrivacy } from '#lib/server/sync/steam';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies, depends }) => {
  depends('app:sync');
  depends('app:invites');
  depends('app:notices');
  const [unread, invites, unseen, steam] = locals.user
    ? await Promise.all([
        unreadCount(locals.user.id),
        pendingInvites(locals.user.id),
        unseenNotices(locals.user.id),
        // Steam cache des jeux à ce joueur : le site le lui dit, où qu'il soit.
        db.linkedAccount.findUnique({
          where: { userId_provider: { userId: locals.user.id, provider: 'STEAM' } },
          select: { playtimeHidden: true, syncError: true },
        }),
      ])
    : [0, { friends: 0, clans: 0 }, 0, null];
  return {
    unread,
    invites,
    notices: { unseen },
    steamPrivacy: steam && steamPrivacy(steam),
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
