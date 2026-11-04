import { fail, redirect } from '@sveltejs/kit';
import { requireLogin } from '#lib/server/auth';
import { rateLimit } from '#lib/server/rate-limit';
import {
  acceptFriend,
  blockUser,
  friendsOverview,
  markInvitesSeen,
  openDirect,
  removeFriend,
  requestFriend,
  unblockUser,
} from '#lib/server/social';
import { MAX_FRIENDS } from '#lib/server/social/shared';
import { m } from '#lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const INVITES_PER_HOUR = 30;

const requireUser = (locals: App.Locals) => requireLogin(locals, '/amis');

const otherId = async (request: Request) => String((await request.formData()).get('id'));

export const load: PageServerLoad = async ({ locals }) => {
  const { id } = requireUser(locals);
  await markInvitesSeen(id, 'friends');
  const overview = await friendsOverview(id);
  return { ...overview, maxFriends: MAX_FRIENDS, friendCount: overview.friends.length };
};

export const actions: Actions = {
  add: async ({ request, locals }) => {
    const user = requireUser(locals);
    if (!rateLimit(`amis:${user.id}`, INVITES_PER_HOUR, 3_600_000)) {
      return fail(429, { error: m.too_fast() });
    }
    const handle = String((await request.formData()).get('handle') ?? '');
    const failure = await requestFriend(user.id, handle);
    if (failure === 'self') return fail(400, { error: m.friend_self() });
    if (failure === 'friends_full')
      return fail(400, { error: m.friends_full({ max: MAX_FRIENDS }) });
    if (failure) return fail(404, { error: m.friend_not_found() });
    return { success: m.friend_requested() };
  },
  accept: async ({ request, locals }) => {
    const failure = await acceptFriend(requireUser(locals).id, await otherId(request));
    if (failure === 'friends_full')
      return fail(400, { error: m.friends_full({ max: MAX_FRIENDS }) });
  },
  remove: async ({ request, locals }) => {
    await removeFriend(requireUser(locals).id, await otherId(request));
  },
  block: async ({ request, locals }) => {
    await blockUser(requireUser(locals).id, await otherId(request));
  },
  unblock: async ({ request, locals }) => {
    await unblockUser(requireUser(locals).id, await otherId(request));
  },
  message: async ({ request, locals }) => {
    const id = await openDirect(requireUser(locals).id, await otherId(request));
    if (!id) return fail(403, { error: m.chat_not_friends() });
    redirect(303, `/messages/${id}`);
  },
};
