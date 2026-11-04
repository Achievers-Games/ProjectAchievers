import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireLogin } from '#lib/server/auth';
import { removeClanImage, setClanImage, type ImageFailure } from '#lib/server/clan-image';
import { db } from '#lib/server/db';
import { rateLimit } from '#lib/server/rate-limit';
import { grantSiteAchievement } from '#lib/server/site-achievements';
import {
  acceptClanInvite,
  createClan,
  declineClanInvite,
  friendsOverview,
  markInvitesSeen,
  inviteToClan,
  kickFromClan,
  leaveClan,
  myClan,
  renameClan,
  type SocialFailure,
} from '#lib/server/social';
import { m } from '#lib/paraglide/messages';
import { getLocale } from '#lib/paraglide/runtime';
import { isProfane } from '#lib/profanity';
import type { Actions, PageServerLoad } from './$types';

const INVITES_PER_HOUR = 30;
/** Chaque envoi passe par l'analyse d'image : pas question d'en faire une boucle. */
const IMAGES_PER_HOUR = 10;

const requireUser = (locals: App.Locals) => requireLogin(locals, '/clan');

const ERRORS: Partial<Record<SocialFailure, () => string>> = {
  name_taken: m.clan_name_taken,
  in_clan: m.clan_already,
  clan_full: m.clan_full,
  owner_only: m.clan_owner_only,
  not_friends: m.chat_not_friends,
};

const failed = (failure: SocialFailure) => fail(409, { error: (ERRORS[failure] ?? m.gone)() });

const IMAGE_ERRORS: Record<ImageFailure, () => string> = {
  owner_only: m.clan_owner_only,
  image_invalid: m.clan_image_invalid,
  image_too_big: m.clan_image_too_big,
  image_refused: m.clan_image_refused,
};

const clanName = z
  .string()
  .trim()
  .min(3, { error: () => m.too_short() })
  .max(32)
  .regex(/^[^\p{C}]+$/u, { error: () => m.profile_name_invalid() })
  .refine((name) => !isProfane(name, getLocale()), { error: () => m.name_profane() });

const field = async (request: Request, name: string) =>
  String((await request.formData()).get(name) ?? '');

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  await markInvitesSeen(user.id, 'clans');
  const [{ membership, invites }, { friends }] = await Promise.all([
    myClan(user.id),
    friendsOverview(user.id),
  ]);
  const members = new Set(membership?.clan.members.map((member) => member.user.id));
  const clan = membership?.clan;
  return {
    // Ses membres voient l'emblème même quand il attend la modération.
    emblem: clan?.imageAt ? `/clans/${clan.slug}/image?v=${clan.imageAt.getTime()}` : null,
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
  rename: async ({ request, locals }) => {
    const user = requireUser(locals);
    const name = clanName.safeParse(await field(request, 'name'));
    if (!name.success) return fail(400, { error: name.error.issues[0]?.message });
    const failure = await renameClan(user.id, name.data);
    return failure ? failed(failure) : { success: m.clan_renamed() };
  },
  image: async ({ request, locals }) => {
    const user = requireUser(locals);
    if (!rateLimit(`clan-image:${user.id}`, IMAGES_PER_HOUR, 3_600_000)) {
      return fail(429, { error: m.too_fast() });
    }
    const file = (await request.formData()).get('image');
    if (!(file instanceof File) || !file.size) return fail(400, { error: m.clan_image_invalid() });
    const result = await setClanImage(user.id, file);
    if ('failure' in result) return fail(400, { error: IMAGE_ERRORS[result.failure]() });
    return { success: result.pending ? m.clan_image_pending() : m.clan_image_saved() };
  },
  removeImage: async ({ locals }) => {
    const failure = await removeClanImage(requireUser(locals).id);
    if (failure) return failed(failure);
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
    const user = requireUser(locals);
    const member = await db.clanMember.count({ where: { userId: user.id } });
    await leaveClan(user.id);
    if (member) await grantSiteAchievement(user.id, 'deserter');
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
