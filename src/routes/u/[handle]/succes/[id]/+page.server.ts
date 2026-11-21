import { error } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { loadUnlockDiscussion, unlockThreadFor } from '#lib/server/activity';
import { requireLogin } from '#lib/server/auth';
import { commentActions } from '#lib/server/comments';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, setHeaders, url }) => {
  const viewer = requireLogin(locals, url.pathname);
  const row = await unlockThreadFor(viewer, params.handle, params.id);
  if (!row) error(404, m.gone());
  setHeaders({ 'cache-control': 'private, no-store' });
  return { thread: await loadUnlockDiscussion(viewer, row, url) };
};

export const actions: Actions = commentActions(async ({ locals, params }) => {
  const row = await unlockThreadFor(locals.user, params.handle ?? '', params.id ?? '');
  return row ? { unlockOwnerId: row.userId, unlockAchievementId: row.achievement.id } : null;
});
