import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, cookies }) => ({
  user: locals.user && {
    id: locals.user.id,
    handle: locals.user.handle,
    displayName: locals.user.displayName,
    avatarUrl: locals.user.avatarUrl,
    avatarMotionUrl: locals.user.avatarMotionUrl,
    frame: locals.user.frame,
    role: locals.user.role,
  },
  theme: cookies.get('pa_theme') === 'light' ? ('light' as const) : ('dark' as const),
});
