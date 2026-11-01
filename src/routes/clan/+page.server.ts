import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireLogin } from '$lib/server/auth';
import { rateLimit } from '$lib/server/rate-limit';
import {
  acceptClanInvite,
  createClan,
  declineClanInvite,
  friendsOverview,
  inviteToClan,
  kickFromClan,
  leaveClan,
  myClan,
  type SocialFailure,
} from '$lib/server/social';
import { m } from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const INVITES_PER_HOUR = 30;

const requireUser = (locals: App.Locals) => requireLogin(locals, '/clan');

const ERRORS: Partial<Record<SocialFailure, () => string>> = {
  name_taken: m.clan_name_taken,
  in_clan: m.clan_already,
  clan_full: m.clan_full,
  owner_only: m.clan_owner_only,
  not_friends: m.chat_not_friends,
};

const failed = (failure: SocialFailure) => fail(409, { error: (ERRORS[failure] ?? m.gone)() });

const clanName = z
  .string()
  .trim()
  .min(3, { error: () => m.too_short() })
  .max(32)
  .regex(/^[^\p{C}]+$/u, { error: () => m.profile_name_invalid() });

const field = async (request: Request, name: string) =>
  String((await request.formData()).get(name) ?? '');

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const [{ membership, invites }, { friends }] = await Promise.all([
    myClan(user.id),
    friendsOverview(user.id),
  ]);
  const members = new Set(membership?.clan.members.map((member) => member.user.id));
  return {
    membership,
    invites,
    invitable: membership?.owner ? friends.filter((friend) => !members.has(friend.id)) : [],
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const user = requireUser(locals);
    const name = clanName.safeParse(await field(request, 'name'));
    if (!name.success) return fail(400, { error: name.error.issues[0]?.message });
    const failure = await createClan(user.id, name.data);
    return failure ? failed(failure) : { success: m.clan_created() };
  },
  invite: async ({ request, locals }) => {
    const user = requireUser(locals);
    if (!rateLimit(`clan:${user.id}`, INVITES_PER_HOUR, 3_600_000)) {
      return fail(429, { error: m.too_fast() });
    }
    const failure = await inviteToClan(user.id, await field(request, 'id'));
    return failure ? failed(failure) : { success: m.clan_invited() };
  },
  accept: async ({ request, locals }) => {
    const failure = await acceptClanInvite(requireUser(locals).id, await field(request, 'id'));
    if (failure) return failed(failure);
  },
  decline: async ({ request, locals }) => {
    await declineClanInvite(requireUser(locals).id, await field(request, 'id'));
  },
  leave: async ({ locals }) => {
    await leaveClan(requireUser(locals).id);
  },
  kick: async ({ request, locals }) => {
    const failure = await kickFromClan(requireUser(locals).id, await field(request, 'id'));
    if (failure) return failed(failure);
  },
  discussion: async ({ locals }) => {
    const { membership } = await myClan(requireUser(locals).id);
    if (membership?.clan.conversation) {
      redirect(303, `/messages/${membership.clan.conversation.id}`);
    }
  },
};
