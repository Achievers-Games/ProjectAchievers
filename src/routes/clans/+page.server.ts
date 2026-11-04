import { fail } from '@sveltejs/kit';
import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import { rateLimit } from '#lib/server/rate-limit';
import { listClans, myClan, requestToJoinClan, type SocialFailure } from '#lib/server/social';
import { m } from '#lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const REQUESTS_PER_HOUR = 10;

const ERRORS: Partial<Record<SocialFailure, () => string>> = {
  in_clan: m.clan_already,
  clan_full: m.clan_full,
  not_found: m.gone,
};

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id ?? null;
  const [clans, mine] = await Promise.all([listClans(), userId ? myClan(userId) : null]);
  const requested = userId
    ? await db.clanRequest.findMany({ where: { userId }, select: { clanId: true } })
    : [];
  return {
    clans,
    inClan: Boolean(mine?.membership),
    myClanId: mine?.membership?.clan.id ?? null,
    requested: requested.map((row) => row.clanId),
  };
};

export const actions: Actions = {
  request: async ({ request, locals }) => {
    const user = requireLogin(locals, '/clans');
    if (!rateLimit(`clan-request-send:${user.id}`, REQUESTS_PER_HOUR, 3_600_000)) {
      return fail(429, { error: m.too_fast() });
    }
    const clanId = String((await request.formData()).get('id') ?? '');
    const failure = await requestToJoinClan(user.id, clanId);
    if (failure) return fail(409, { error: (ERRORS[failure] ?? m.gone)() });
    return { success: m.clan_request_sent() };
  },
};
