import { Prisma, type Provider } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { encrypt } from './crypto';
import { slugify } from '$lib/slug';
import { m } from '$lib/paraglide/messages';

export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, { error: () => m.profile_name_short() })
    .max(32, { error: () => m.profile_name_long() })
    .regex(/^[^\p{C}]+$/u, { error: () => m.profile_name_invalid() }),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/, { error: () => m.profile_handle_invalid() }),
  /** Absent quand l'image actuelle ne correspond plus à un compte lié : elle est conservée. */
  avatarUrl: z.string().optional(),
});

/** Le nom et l'identifiant restent ceux choisis ici : une reconnexion ne les écrase pas. */
export async function updateProfile(
  userId: string,
  input: z.infer<typeof profileSchema>,
): Promise<'handle_taken' | 'avatar_unknown' | null> {
  // Seule l'image d'un compte lié est acceptée : aucune adresse libre n'atteint les profils publics.
  const account = input.avatarUrl
    ? await db.linkedAccount.findFirst({
        where: { userId, avatarUrl: input.avatarUrl },
        select: { avatarMotionUrl: true },
      })
    : null;
  if (input.avatarUrl && !account) return 'avatar_unknown';

  try {
    await db.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName,
        handle: input.handle,
        ...(input.avatarUrl !== undefined && {
          avatarUrl: input.avatarUrl || null,
          avatarMotionUrl: account?.avatarMotionUrl ?? null,
        }),
      },
    });
    return null;
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      return 'handle_taken';
    }
    throw cause;
  }
}

export interface Identity {
  provider: Provider;
  providerUserId: string;
  displayName: string;
  avatarUrl?: string | null;
  avatarMotionUrl?: string | null;
  profileUrl?: string | null;
  accessToken?: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}

type LinkResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: 'already_linked'; ownerId: string }
  | { ok: false; reason: 'provider_taken' };

function accountData(identity: Identity) {
  return {
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    avatarMotionUrl: identity.avatarMotionUrl,
    profileUrl: identity.profileUrl,
    accessTokenEnc: identity.accessToken ? encrypt(identity.accessToken) : null,
    refreshTokenEnc: identity.refreshToken ? encrypt(identity.refreshToken) : null,
    tokenExpiresAt: identity.tokenExpiresAt ?? null,
  };
}

/** Met à jour l'animation d'un compte, et celle du profil s'il utilise l'image de ce compte. */
export async function applyAvatarMotion(accountId: string, avatarMotionUrl: string | null) {
  const account = await db.linkedAccount.update({
    where: { id: accountId },
    data: { avatarMotionUrl },
    select: { userId: true, avatarUrl: true },
  });
  if (!account.avatarUrl) return;
  await db.user.updateMany({
    where: { id: account.userId, avatarUrl: account.avatarUrl },
    data: { avatarMotionUrl },
  });
}

async function uniqueHandle(name: string): Promise<string> {
  const base = slugify(name).slice(0, 24) || 'chasseur';
  for (let suffix = 1; suffix < 1000; suffix++) {
    const handle = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await db.user.findUnique({ where: { handle }, select: { id: true } }))) return handle;
  }
  throw new Error('Impossible de générer un identifiant unique');
}

/**
 * Rattache une identité vérifiée par un fournisseur.
 *
 * Seul le couple fournisseur + identifiant fournisseur désigne un utilisateur.
 * Un pseudo ou un e-mail ne sert jamais à retrouver un compte : deux personnes
 * peuvent choisir le même nom.
 */
export async function resolveIdentity(
  identity: Identity,
  currentUserId: string | null,
): Promise<LinkResult> {
  const where = {
    provider_providerUserId: {
      provider: identity.provider,
      providerUserId: identity.providerUserId,
    },
  };
  const existing = await db.linkedAccount.findUnique({ where });

  if (existing) {
    if (currentUserId && existing.userId !== currentUserId) {
      return { ok: false, reason: 'already_linked', ownerId: existing.userId };
    }
    await db.linkedAccount.update({
      where,
      data: {
        ...accountData(identity),
        // Le statut d'une synchronisation en cours ne doit pas être écrasé.
        ...(existing.syncStatus === 'NEEDS_RELINK' && { syncStatus: 'IDLE', syncError: null }),
      },
    });
    await applyAvatarMotion(existing.id, identity.avatarMotionUrl ?? null);
    return { ok: true, userId: existing.userId, created: false };
  }

  if (currentUserId) {
    const sameProvider = await db.linkedAccount.findUnique({
      where: { userId_provider: { userId: currentUserId, provider: identity.provider } },
    });
    if (sameProvider) return { ok: false, reason: 'provider_taken' };

    await db.linkedAccount.create({
      data: {
        ...accountData(identity),
        userId: currentUserId,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
      },
    });
    return { ok: true, userId: currentUserId, created: false };
  }

  const user = await db.user.create({
    data: {
      handle: await uniqueHandle(identity.displayName),
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      avatarMotionUrl: identity.avatarMotionUrl,
      accounts: {
        create: {
          ...accountData(identity),
          provider: identity.provider,
          providerUserId: identity.providerUserId,
        },
      },
    },
  });
  return { ok: true, userId: user.id, created: true };
}
