import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Provider } from '@prisma/client';
import { profileSchema, resolveIdentity, updateProfile } from '$lib/server/accounts';
import { db } from '$lib/server/db';
import { clearMerge, mergePreview, mergeUsers, readMerge, saveMerge } from '$lib/server/merge';
import { availableProviders } from '$lib/server/providers';
import { bioContainsCode, findPsnProfile, newPsnCode } from '$lib/server/providers/psn';
import { destroySession } from '$lib/server/session';
import { enqueueSync } from '$lib/server/sync/queue';
import type { Actions, PageServerLoad } from './$types';

const NOTICES: Record<string, string> = {
  provider_taken: 'Un compte de ce type est déjà lié. Dissocie-le pour en lier un autre.',
};

const MERGE_ERRORS = {
  stale: 'Cette demande de fusion n’est plus valable. Lie le compte à nouveau.',
  sync_running: 'Une synchronisation est en cours. Réessaie quand elle sera terminée.',
  provider_conflict: 'Les deux profils ont un compte du même type. Dissocie-le avant de fusionner.',
};

const PROFILE_ERRORS = {
  handle_taken: 'Cet identifiant est déjà pris.',
  avatar_unknown: 'Cette image ne vient pas de tes comptes liés.',
};

const LOGIN_PROVIDERS: Provider[] = ['STEAM', 'DISCORD', 'XBOX', 'GOOGLE'];
const PSN_CODE_LIFETIME = 30 * 60 * 1000;

function requireUser(locals: App.Locals) {
  if (!locals.user) redirect(303, '/connexion?retour=/compte');
  return locals.user;
}

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
  const user = requireUser(locals);
  const pendingMerge = readMerge(cookies, user.id);

  const [profile, accounts, sessions, psn, merge] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { displayName: true, handle: true, avatarUrl: true, isPublic: true, showAdult: true },
    }),
    db.linkedAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        provider: true,
        displayName: true,
        avatarUrl: true,
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
  ]);

  return {
    profile,
    merge,
    accounts,
    sessions: sessions.map((s) => ({ ...s, current: s.id === user.sessionId })),
    providers: availableProviders(),
    psn: psn && psn.expiresAt > new Date() ? { onlineId: psn.onlineId, code: psn.code } : null,
    welcome: url.searchParams.has('bienvenue'),
    notice: NOTICES[url.searchParams.get('erreur') ?? ''] ?? null,
  };
};

const onlineId = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{2,15}$/, "Cet identifiant PSN n'est pas valide.");

const providerSchema = z.enum(['STEAM', 'PSN', 'XBOX', 'DISCORD', 'GOOGLE']);

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
    if (failure) return fail(409, { error: PROFILE_ERRORS[failure] });
    return { success: 'Profil enregistré.' };
  },

  sync: async ({ request, locals }) => {
    const user = requireUser(locals);
    const provider = providerSchema.safeParse((await request.formData()).get('provider'));
    if (!provider.success) return fail(400, { error: 'Compte inconnu.' });
    const started = await enqueueSync(user.id, provider.data);
    return started
      ? { success: 'Synchronisation lancée.' }
      : fail(409, { error: 'Une synchronisation est déjà en cours.' });
  },

  unlink: async ({ request, locals }) => {
    const user = requireUser(locals);
    const provider = providerSchema.safeParse((await request.formData()).get('provider'));
    if (!provider.success) return fail(400, { error: 'Compte inconnu.' });

    const accounts = await db.linkedAccount.findMany({
      where: { userId: user.id },
      select: { provider: true, syncStatus: true },
    });
    const target = accounts.find((a) => a.provider === provider.data);
    if (!target) return fail(404, { error: 'Ce compte n’est pas lié.' });
    if (target.syncStatus === 'QUEUED' || target.syncStatus === 'SYNCING') {
      return fail(409, {
        error: 'Une synchronisation est en cours. Réessaie quand elle sera finie.',
      });
    }

    const remainingLogin = accounts.some(
      (a) => a.provider !== provider.data && LOGIN_PROVIDERS.includes(a.provider),
    );
    if (!remainingLogin) {
      return fail(409, {
        error: 'Garde au moins un compte Steam, Discord, Xbox ou Google : il sert à te connecter.',
      });
    }

    await db.$transaction(async (tx) => {
      await tx.linkedAccount.delete({
        where: { userId_provider: { userId: user.id, provider: provider.data } },
      });
      if (provider.data !== 'DISCORD' && provider.data !== 'GOOGLE') {
        const platform = provider.data;
        await tx.userAchievement.deleteMany({
          where: { userId: user.id, achievement: { game: { platform } } },
        });
        await tx.userGame.deleteMany({ where: { userId: user.id, game: { platform } } });
      }
    });
    return { success: 'Compte dissocié, ses données ont été retirées de ton profil.' };
  },

  merge: async ({ locals, cookies }) => {
    const user = requireUser(locals);
    const pending = readMerge(cookies, user.id);
    if (!pending) return fail(410, { error: MERGE_ERRORS.stale });

    const failure = await mergeUsers(pending);
    if (failure === 'sync_running' || failure === 'provider_conflict') {
      return fail(409, { error: MERGE_ERRORS[failure] });
    }
    clearMerge(cookies);
    if (failure) return fail(410, { error: MERGE_ERRORS[failure] });
    return { success: 'Profils fusionnés. Tous tes comptes ouvrent maintenant ce profil.' };
  },

  mergeCancel: async ({ cookies }) => {
    clearMerge(cookies);
  },

  visibility: async ({ request, locals }) => {
    const user = requireUser(locals);
    const isPublic = (await request.formData()).get('isPublic') === 'on';
    await db.user.update({ where: { id: user.id }, data: { isPublic } });
    return { success: isPublic ? 'Ton profil est public.' : 'Ton profil est privé.' };
  },

  adult: async ({ request, locals }) => {
    const user = requireUser(locals);
    const showAdult = (await request.formData()).get('showAdult') === 'on';
    await db.user.update({ where: { id: user.id }, data: { showAdult } });
    return { success: showAdult ? 'Jeux pour adultes affichés.' : 'Jeux pour adultes masqués.' };
  },

  theme: async ({ request, cookies }) => {
    const theme = (await request.formData()).get('theme') === 'light' ? 'light' : 'dark';
    cookies.set('pa_theme', theme, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
    });
  },

  revokeSession: async ({ request, locals }) => {
    const user = requireUser(locals);
    const id = String((await request.formData()).get('id'));
    await db.session.deleteMany({ where: { id, userId: user.id, NOT: { id: user.sessionId } } });
    return { success: 'Session déconnectée.' };
  },

  revokeOthers: async ({ locals }) => {
    const user = requireUser(locals);
    const { count } = await db.session.deleteMany({
      where: { userId: user.id, NOT: { id: user.sessionId } },
    });
    return {
      success: `${count} session${count > 1 ? 's' : ''} déconnectée${count > 1 ? 's' : ''}.`,
    };
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
      return fail(502, { error: 'PlayStation Network ne répond pas. Réessaie plus tard.' });
    }
    if (!profile) return fail(404, { error: 'Aucun profil PSN à ce nom.' });

    const data = {
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
    if (!pending || pending.expiresAt < new Date()) {
      return fail(410, { error: 'Le code a expiré. Recommence la liaison.' });
    }

    let profile;
    try {
      profile = await findPsnProfile(pending.onlineId);
    } catch (cause) {
      console.error('Vérification PSN :', cause);
      return fail(502, { error: 'PlayStation Network ne répond pas. Réessaie plus tard.' });
    }
    if (!profile || profile.accountId !== pending.accountId) {
      return fail(404, { error: 'Ce profil PSN a changé. Recommence la liaison.' });
    }
    if (!bioContainsCode(profile.aboutMe, pending.code)) {
      return fail(409, {
        error: `Le code ${pending.code} n'apparaît pas encore dans ta bio PSN.`,
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
      return fail(409, { error: NOTICES[result.reason] });
    }

    await db.psnVerification.delete({ where: { userId: user.id } });
    if (!result.ok) {
      saveMerge(cookies, {
        sourceId: result.ownerId,
        targetId: user.id,
        provider: 'PSN',
        providerUserId: profile.accountId,
      });
      return { success: 'Ce compte PlayStation appartient à un autre de tes profils.' };
    }

    await enqueueSync(user.id, 'PSN');
    return { success: 'Compte PlayStation lié. Tu peux retirer le code de ta bio.' };
  },

  psnCancel: async ({ locals }) => {
    const user = requireUser(locals);
    await db.psnVerification.deleteMany({ where: { userId: user.id } });
  },

  delete: async ({ request, locals, cookies }) => {
    const user = requireUser(locals);
    if ((await request.formData()).get('confirmation') !== user.handle) {
      return fail(400, { error: 'Saisis ton identifiant pour confirmer.' });
    }
    await destroySession(cookies);
    await db.psnVerification.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    redirect(303, '/');
  },
};
