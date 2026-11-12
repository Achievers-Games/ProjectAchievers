import { Prisma, type Platform, type Provider } from '#prisma';
import { z } from 'zod';
import { db } from './db';
import { queueAccountEvent } from './partner-webhooks';
import { encrypt } from './crypto';
import { availableProviders } from './providers';
import { isProfane } from '#lib/profanity';
import { slugify } from '#lib/slug';
import { m } from '#lib/paraglide/messages';
import { getLocale } from '#lib/paraglide/runtime';

const PLATFORMS: Platform[] = ['STEAM', 'PSN', 'XBOX', 'RETRO', 'BLIZZARD'];

/** Les plateformes de jeu ouvertes sur ce site que le joueur n'a pas encore liées. */
export async function unlinkedPlatforms(userId: string) {
  const available = availableProviders();
  const linked = await db.linkedAccount.findMany({ where: { userId }, select: { provider: true } });
  const taken = new Set<Provider>(linked.map((account) => account.provider));
  return PLATFORMS.filter((platform) => available[platform] && !taken.has(platform));
}

export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, { error: () => m.profile_name_short() })
    .max(32, { error: () => m.profile_name_long() })
    .regex(/^[^\p{C}]+$/u, { error: () => m.profile_name_invalid() })
    .refine((name) => !isProfane(name, getLocale()), { error: () => m.name_profane() }),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/, { error: () => m.profile_handle_invalid() })
    .refine((handle) => !isProfane(handle, getLocale()), { error: () => m.name_profane() }),
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

  const before = await db.user.findUnique({
    where: { id: userId },
    select: { handle: true, avatarUrl: true },
  });
  try {
    const after = await db.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName,
        handle: input.handle,
        ...(input.avatarUrl !== undefined && {
          avatarUrl: input.avatarUrl || null,
          avatarMotionUrl: account?.avatarMotionUrl ?? null,
        }),
      },
      select: { handle: true, avatarUrl: true },
    });
    if (before?.handle !== after.handle || before?.avatarUrl !== after.avatarUrl) {
      await queueAccountEvent(userId, 'user.updated');
    }
    return null;
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      return 'handle_taken';
    }
    throw cause;
  }
}

/** Ce qu'un compte apporte à l'apparence du profil, en plus de son image. */
export interface AccountLook {
  avatarMotionUrl: string | null;
  frameUrl: string | null;
  frameMotionUrl: string | null;
}

export type BlizzardCharacter = { region: string; realm: string; name: string };

export interface Identity {
  provider: Provider;
  providerUserId: string;
  displayName: string;
  avatarUrl?: string | null;
  avatarMotionUrl?: string | null;
  frameUrl?: string | null;
  frameMotionUrl?: string | null;
  profileUrl?: string | null;
  accessToken?: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  /** Absent : la liste n'a pas pu être lue, celle déjà connue reste en place. */
  characters?: BlizzardCharacter[];
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
    frameUrl: identity.frameUrl,
    frameMotionUrl: identity.frameMotionUrl,
    profileUrl: identity.profileUrl,
    accessTokenEnc: identity.accessToken ? encrypt(identity.accessToken) : null,
    refreshTokenEnc: identity.refreshToken ? encrypt(identity.refreshToken) : null,
    tokenExpiresAt: identity.tokenExpiresAt ?? null,
    ...(identity.characters && { characters: identity.characters }),
  };
}

/** Ce qu'une identité ne précise pas reste tel quel : la plateforme n'a peut-être pas répondu. */
export const identityLook = (identity: Identity, account: AccountLook): AccountLook => ({
  avatarMotionUrl:
    identity.avatarMotionUrl === undefined ? account.avatarMotionUrl : identity.avatarMotionUrl,
  frameUrl: identity.frameUrl === undefined ? account.frameUrl : identity.frameUrl,
  frameMotionUrl:
    identity.frameMotionUrl === undefined ? account.frameMotionUrl : identity.frameMotionUrl,
});

/** Reporte sur le compte et sur le profil ce que le joueur a changé sur la plateforme. */
export async function applyAccountLook(
  account: { id: string; userId: string; avatarUrl: string | null; frameUrl: string | null },
  look: AccountLook,
  avatarUrl = account.avatarUrl,
) {
  await db.linkedAccount.update({ where: { id: account.id }, data: { ...look, avatarUrl } });
  if (account.avatarUrl) {
    await db.user.updateMany({
      where: { id: account.userId, avatarUrl: account.avatarUrl },
      data: { avatarUrl, avatarMotionUrl: look.avatarMotionUrl },
    });
  }
  // Un cadre retiré de la plateforme disparaît aussi du profil qui l'avait équipé.
  if (account.frameUrl) {
    await db.user.updateMany({
      where: { id: account.userId, frame: account.frameUrl },
      data: { frame: look.frameUrl, frameMotionUrl: look.frameMotionUrl },
    });
  }
}

/** Reste valide pour le formulaire de profil : de 3 à 24 caractères, suffixe compris. */
async function uniqueHandle(name: string): Promise<string> {
  const slug = slugify(name).slice(0, 20).replace(/-+$/, '');
  const base = slug.length >= 3 ? slug : 'chasseur';
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
  try {
    return await resolveOnce(identity, currentUserId);
  } catch (cause) {
    // Deux connexions à la fois (double clic, deux onglets) : l'autre a créé le compte ou pris
    // l'identifiant entre la lecture et l'écriture. La seconde lecture retrouve ce qu'elle a écrit.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      return resolveOnce(identity, currentUserId);
    }
    throw cause;
  }
}

async function resolveOnce(identity: Identity, currentUserId: string | null): Promise<LinkResult> {
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
    await applyAccountLook(existing, identityLook(identity, existing), identity.avatarUrl);
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

  // Le nom vient de la plateforme : le joueur le choisira lui-même s'il est refusé ici.
  const displayName = isProfane(identity.displayName, getLocale())
    ? 'Chasseur'
    : identity.displayName;
  const user = await db.user.create({
    data: {
      handle: await uniqueHandle(displayName),
      displayName,
      avatarUrl: identity.avatarUrl,
      avatarMotionUrl: identity.avatarMotionUrl,
      frame: identity.frameUrl,
      frameMotionUrl: identity.frameMotionUrl,
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
