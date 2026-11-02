import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Provider } from '@prisma/client';
import { profileSchema, resolveIdentity, updateProfile } from '$lib/server/accounts';
import { requireLogin } from '$lib/server/auth';
import { secureCookie } from '$lib/server/cookies';
import { db } from '$lib/server/db';
import { clearMerge, mergePreview, mergeUsers, readMerge, saveMerge } from '$lib/server/merge';
import { availableProviders } from '$lib/server/providers';
import { bioContainsCode, findPsnProfile, newPsnCode } from '$lib/server/providers/psn';
import { findRetroProfile } from '$lib/server/providers/retro';
import { destroySession } from '$lib/server/session';
import { grantSiteAchievement } from '$lib/server/site-achievements';
import { leaveClan } from '$lib/server/social';
import { forgetPresence } from '$lib/server/presence';
import { pushPublicKey } from '$lib/server/push';
import { enqueueSync } from '$lib/server/sync/queue';
import { requestStoreSweep } from '$lib/server/sync/steam';
import type { Actions, PageServerLoad } from './$types';
import { m } from '$lib/paraglide/messages';

const NOTICES: Record<string, () => string> = {
  provider_taken: m.provider_taken,
};

const MERGE_ERRORS = {
  stale: m.merge_stale,
  sync_running: m.merge_busy,
  provider_conflict: m.merge_blocked,
  clan_choice: m.merge_clan_required,
};

const PROFILE_ERRORS = {
  handle_taken: m.profile_handle_taken,
  avatar_unknown: m.profile_avatar_unknown,
};

const LOGIN_PROVIDERS: Provider[] = ['STEAM', 'DISCORD', 'XBOX', 'GOOGLE'];
const PSN_CODE_LIFETIME = 30 * 60 * 1000;

const requireUser = (locals: App.Locals) => requireLogin(locals, '/compte');

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
  const user = requireUser(locals);
  const pendingMerge = readMerge(cookies, user.id);

  const [profile, accounts, sessions, pending, merge, earned] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        displayName: true,
        handle: true,
        avatarUrl: true,
        avatarMotionUrl: true,
        frame: true,
        frameMotionUrl: true,
        isPublic: true,
        showOnline: true,
        showAdult: true,
        allowProfanity: true,
        pushMessages: true,
        pushInvites: true,
        pushEvents: true,
      },
    }),
    db.linkedAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        provider: true,
        displayName: true,
        avatarUrl: true,
        avatarMotionUrl: true,
        frameUrl: true,
        frameMotionUrl: true,
        syncStatus: true,
        syncError: true,
        lastSyncedAt: true,
      },
    }),
    db.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true },
    }),
    db.psnVerification.findUnique({ where: { userId: user.id } }),
    pendingMerge ? mergePreview(pendingMerge) : null,
    db.userFrame.findMany({ where: { userId: user.id }, select: { frame: true } }),
  ]);

  const activeCheck = (provider: Provider) =>
    pending?.provider === provider && pending.expiresAt > new Date()
      ? { onlineId: pending.onlineId, code: pending.code }
      : null;

  return {
    profile,
    pushKey: pushPublicKey(),
    frames: earned.map((row) => row.frame),
    merge,
    accounts,
    sessions: sessions.map((s) => ({ ...s, current: s.id === user.sessionId })),
    providers: availableProviders(),
    psn: activeCheck('PSN'),
    retro: activeCheck('RETRO'),
    welcome: url.searchParams.has('bienvenue'),
    notice: NOTICES[url.searchParams.get('erreur') ?? ''] ?? null,
  };
};

const onlineId = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{2,15}$/, { error: () => m.psn_id_invalid() });

const retroName = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9]{2,20}$/, { error: () => m.retro_id_invalid() });

const providerSchema = z.enum([
  'STEAM',
  'PSN',
  'XBOX',
  'DISCORD',
  'GOOGLE',
  'RETRO',
  'EPIC',
  'BLIZZARD',
]);

export const actions: Actions = {
  profile: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const parsed = profileSchema.safeParse({
      displayName: form.get('displayName'),
      handle: form.get('handle'),
      avatarUrl: form.get('avatarUrl') ?? undefined,
    });
    if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message });

    const failure = await updateProfile(user.id, parsed.data);
    if (failure) return fail(409, { error: PROFILE_ERRORS[failure]() });
    const { handle, displayName, avatarUrl } = parsed.data;
    if (handle !== user.handle || displayName !== user.displayName) {
      await grantSiteAchievement(user.id, 'stage_name');
    }
    if (avatarUrl !== undefined && (avatarUrl || null) !== user.avatarUrl) {
      await grantSiteAchievement(user.id, 'makeover');
    }
    return { success: m.profile_saved() };
  },

  sync: async ({ request, locals }) => {
    const user = requireUser(locals);
    const provider = providerSchema.safeParse((await request.formData()).get('provider'));
    if (!provider.success) return fail(400, { error: m.account_unknown() });
    const started = await enqueueSync(user.id, provider.data);
    if (started && provider.data === 'STEAM') await requestStoreSweep(user.id);
    return started ? { success: m.sync_started() } : fail(409, { error: m.sync_already() });
  },

  unlink: async ({ request, locals }) => {
    const user = requireUser(locals);
    const provider = providerSchema.safeParse((await request.formData()).get('provider'));
    if (!provider.success) return fail(400, { error: m.account_unknown() });

    const accounts = await db.linkedAccount.findMany({
      where: { userId: user.id },
      select: { provider: true, syncStatus: true, frameUrl: true },
    });
    const target = accounts.find((a) => a.provider === provider.data);
    if (!target) return fail(404, { error: m.account_not_linked() });
    if (target.syncStatus === 'QUEUED' || target.syncStatus === 'SYNCING') {
      return fail(409, {
        error: m.sync_wait(),
      });
    }

    const remainingLogin = accounts.some(
      (a) => a.provider !== provider.data && LOGIN_PROVIDERS.includes(a.provider),
    );
    if (!remainingLogin) {
      return fail(409, {
        error: m.keep_one_login(),
      });
    }

    await db.$transaction(async (tx) => {
      if (target.frameUrl) {
        await tx.user.updateMany({
          where: { id: user.id, frame: target.frameUrl },
          data: { frame: null, frameMotionUrl: null },
        });
      }
      await tx.linkedAccount.delete({
        where: { userId_provider: { userId: user.id, provider: provider.data } },
      });
      if (provider.data !== 'DISCORD' && provider.data !== 'GOOGLE' && provider.data !== 'EPIC') {
        const platform = provider.data;
        await tx.pinnedGame.deleteMany({ where: { userId: user.id, game: { platform } } });
        await tx.userAchievement.deleteMany({
          where: { userId: user.id, achievement: { game: { platform } } },
        });
        await tx.userGame.deleteMany({ where: { userId: user.id, game: { platform } } });
      }
    });
    return { success: m.account_unlinked() };
  },

  merge: async ({ request, locals, cookies }) => {
    const user = requireUser(locals);
    const pending = readMerge(cookies, user.id);
    if (!pending) return fail(410, { error: MERGE_ERRORS.stale() });

    const choice = (await request.formData()).get('clan');
    const failure = await mergeUsers(
      pending,
      choice === 'source' || choice === 'target' ? choice : undefined,
    );
    if (
      failure === 'sync_running' ||
      failure === 'provider_conflict' ||
      failure === 'clan_choice'
    ) {
      return fail(409, { error: MERGE_ERRORS[failure]() });
    }
    clearMerge(cookies);
    if (failure) return fail(410, { error: MERGE_ERRORS[failure]() });
    return { success: m.merge_done() };
  },

  mergeCancel: async ({ cookies }) => {
    clearMerge(cookies);
  },

  frame: async ({ request, locals }) => {
    const user = requireUser(locals);
    const frame = String((await request.formData()).get('frame') ?? '');
    const provider = providerSchema.safeParse(frame.replace('compte:', ''));
    if (frame.startsWith('compte:')) {
      // Seul le cadre d'un compte lié est accepté : aucune adresse libre n'atteint les profils.
      const account = provider.success
        ? await db.linkedAccount.findFirst({
            where: { userId: user.id, provider: provider.data, frameUrl: { not: null } },
            select: { frameUrl: true, frameMotionUrl: true },
          })
        : null;
      if (!account) return fail(403, { error: m.frame_unknown() });
      await db.user.update({
        where: { id: user.id },
        data: { frame: account.frameUrl, frameMotionUrl: account.frameMotionUrl },
      });
      return { success: m.frame_saved() };
    }
    if (frame) {
      const owned = await db.userFrame.count({ where: { userId: user.id, frame } });
      if (!owned) return fail(403, { error: m.frame_unknown() });
    }
    await db.user.update({
      where: { id: user.id },
      data: { frame: frame || null, frameMotionUrl: null },
    });
    return { success: m.frame_saved() };
  },

  visibility: async ({ request, locals }) => {
    const user = requireUser(locals);
    const isPublic = (await request.formData()).get('isPublic') === 'on';
    await db.user.update({ where: { id: user.id }, data: { isPublic } });
    forgetPresence();
    return { success: isPublic ? m.profile_public_ok() : m.profile_private_ok() };
  },

  notifications: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    await db.user.update({
      where: { id: user.id },
      data: {
        pushMessages: form.get('messages') === 'on',
        pushInvites: form.get('invites') === 'on',
        pushEvents: form.get('events') === 'on',
      },
    });
    return { success: m.push_saved() };
  },

  presence: async ({ request, locals }) => {
    const user = requireUser(locals);
    const showOnline = (await request.formData()).get('showOnline') === 'on';
    await db.user.update({ where: { id: user.id }, data: { showOnline } });
    forgetPresence();
    return { success: m.online_status_saved() };
  },

  profanity: async ({ request, locals }) => {
    const user = requireUser(locals);
    const allowProfanity = (await request.formData()).get('allowProfanity') === 'on';
    await db.user.update({ where: { id: user.id }, data: { allowProfanity } });
    return { success: allowProfanity ? m.profanity_off() : m.profanity_on() };
  },

  adult: async ({ request, locals }) => {
    const user = requireUser(locals);
    const showAdult = (await request.formData()).get('showAdult') === 'on';
    await db.user.update({ where: { id: user.id }, data: { showAdult } });
    return { success: showAdult ? m.adult_on() : m.adult_off() };
  },

  theme: async ({ request, cookies }) => {
    const theme = (await request.formData()).get('theme') === 'light' ? 'light' : 'dark';
    cookies.set('pa_theme', theme, {
      ...secureCookie,
      path: '/',
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 365,
    });
  },

  revokeSession: async ({ request, locals }) => {
    const user = requireUser(locals);
    const id = String((await request.formData()).get('id'));
    await db.session.deleteMany({ where: { id, userId: user.id, NOT: { id: user.sessionId } } });
    return { success: m.session_revoked() };
  },

  revokeOthers: async ({ locals }) => {
    const user = requireUser(locals);
    const { count } = await db.session.deleteMany({
      where: { userId: user.id, NOT: { id: user.sessionId } },
    });
    return { success: m.count_sessions_closed({ count }) };
  },

  psnStart: async ({ request, locals }) => {
    const user = requireUser(locals);
    const parsed = onlineId.safeParse((await request.formData()).get('onlineId'));
    if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message });

    let profile;
    try {
      profile = await findPsnProfile(parsed.data);
    } catch (cause) {
      console.error('Recherche PSN :', cause);
      return fail(502, { error: m.psn_down() });
    }
    if (!profile) return fail(404, { error: m.psn_not_found() });

    const data = {
      provider: 'PSN' as const,
      onlineId: profile.onlineId,
      accountId: profile.accountId,
      code: newPsnCode(),
      expiresAt: new Date(Date.now() + PSN_CODE_LIFETIME),
    };
    await db.psnVerification.upsert({
      where: { userId: user.id },
      update: data,
      create: { ...data, userId: user.id },
    });
  },

  psnConfirm: async ({ locals, cookies }) => {
    const user = requireUser(locals);
    const pending = await db.psnVerification.findUnique({ where: { userId: user.id } });
    if (pending?.provider !== 'PSN' || pending.expiresAt < new Date()) {
      return fail(410, { error: m.psn_code_expired() });
    }

    let profile;
    try {
      profile = await findPsnProfile(pending.onlineId);
    } catch (cause) {
      console.error('Vérification PSN :', cause);
      return fail(502, { error: m.psn_down() });
    }
    if (!profile || profile.accountId !== pending.accountId) {
      return fail(404, { error: m.psn_changed() });
    }
    if (!bioContainsCode(profile.aboutMe, pending.code)) {
      return fail(409, {
        error: m.psn_code_missing({ code: pending.code }),
      });
    }

    const result = await resolveIdentity(
      {
        provider: 'PSN',
        providerUserId: profile.accountId,
        displayName: profile.onlineId,
        avatarUrl: profile.avatarUrl,
        profileUrl: `https://psnprofiles.com/${encodeURIComponent(profile.onlineId)}`,
      },
      user.id,
    );
    if (!result.ok && result.reason === 'provider_taken') {
      return fail(409, { error: NOTICES[result.reason]?.() });
    }

    await db.psnVerification.delete({ where: { userId: user.id } });
    if (!result.ok) {
      saveMerge(cookies, {
        sourceId: result.ownerId,
        targetId: user.id,
        provider: 'PSN',
        providerUserId: profile.accountId,
      });
      return { success: m.psn_other_profile() };
    }

    await enqueueSync(user.id, 'PSN');
    return { success: m.psn_linked() };
  },

  retroStart: async ({ request, locals }) => {
    const user = requireUser(locals);
    const parsed = retroName.safeParse((await request.formData()).get('username'));
    if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message });

    const profile = await findRetroProfile(parsed.data).catch((cause) => {
      console.error('Recherche RetroAchievements :', cause);
      return undefined;
    });
    if (profile === undefined) return fail(502, { error: m.retro_down() });
    if (!profile) return fail(404, { error: m.retro_not_found() });

    const data = {
      provider: 'RETRO' as const,
      onlineId: profile.username,
      accountId: profile.ulid,
      code: newPsnCode(),
      expiresAt: new Date(Date.now() + PSN_CODE_LIFETIME),
    };
    await db.psnVerification.upsert({
      where: { userId: user.id },
      update: data,
      create: { ...data, userId: user.id },
    });
  },

  retroConfirm: async ({ locals, cookies }) => {
    const user = requireUser(locals);
    const pending = await db.psnVerification.findUnique({ where: { userId: user.id } });
    if (pending?.provider !== 'RETRO' || pending.expiresAt < new Date()) {
      return fail(410, { error: m.psn_code_expired() });
    }

    const profile = await findRetroProfile(pending.accountId).catch((cause) => {
      console.error('Vérification RetroAchievements :', cause);
      return undefined;
    });
    if (profile === undefined) return fail(502, { error: m.retro_down() });
    if (!profile) return fail(404, { error: m.retro_not_found() });
    if (!bioContainsCode(profile.motto, pending.code)) {
      return fail(409, { error: m.retro_code_missing({ code: pending.code }) });
    }

    const result = await resolveIdentity(
      {
        provider: 'RETRO',
        providerUserId: profile.ulid,
        displayName: profile.username,
        avatarUrl: profile.avatarUrl,
        profileUrl: `https://retroachievements.org/user/${encodeURIComponent(profile.username)}`,
      },
      user.id,
    );
    if (!result.ok && result.reason === 'provider_taken') {
      return fail(409, { error: NOTICES[result.reason]?.() });
    }

    await db.psnVerification.delete({ where: { userId: user.id } });
    if (!result.ok) {
      saveMerge(cookies, {
        sourceId: result.ownerId,
        targetId: user.id,
        provider: 'RETRO',
        providerUserId: profile.ulid,
      });
      return { success: m.psn_other_profile() };
    }

    await enqueueSync(user.id, 'RETRO');
    return { success: m.retro_linked() };
  },

  psnCancel: async ({ locals }) => {
    const user = requireUser(locals);
    await db.psnVerification.deleteMany({ where: { userId: user.id } });
  },

  delete: async ({ request, locals, cookies }) => {
    const user = requireUser(locals);
    if ((await request.formData()).get('confirmation') !== user.handle) {
      return fail(400, { error: m.delete_account_confirm() });
    }
    await destroySession(cookies);
    await db.psnVerification.deleteMany({ where: { userId: user.id } });
    await leaveClan(user.id);
    await db.user.delete({ where: { id: user.id } });
    redirect(303, '/');
  },
};
