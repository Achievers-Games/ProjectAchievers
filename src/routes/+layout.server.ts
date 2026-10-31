import { pushPublicKey } from '$lib/server/push';
import { unreadCount } from '$lib/server/social';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => ({
  unread: locals.user ? await unreadCount(locals.user.id) : 0,
  pushKey: pushPublicKey(),
  user: locals.user && {
    id: locals.user.id,
    handle: locals.user.handle,
    displayName: locals.user.displayName,
    avatarUrl: locals.user.avatarUrl,
    avatarMotionUrl: locals.user.avatarMotionUrl,
    frame: locals.user.frame,
    frameMotionUrl: locals.user.frameMotionUrl,
    role: locals.user.role,
  },
  theme: cookies.get('pa_theme') === 'light' ? ('light' as const) : ('dark' as const),
});
