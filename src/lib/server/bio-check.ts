import { fail, type Cookies } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { resolveIdentity, type Identity } from './accounts';
import { db } from './db';
import { saveMerge } from './merge';
import { newPsnCode } from './providers/psn';
import { rateLimit } from './rate-limit';
import { enqueueSync } from './sync/queue';

const CODE_LIFETIME = 30 * 60 * 1000;

/**
 * PSN et RetroAchievements n'ont pas de connexion OAuth : le joueur prouve qu'il possède le
 * profil en y posant un code. Les trois étapes sont les mêmes pour les deux plateformes.
 */
export type BioProvider = 'PSN' | 'RETRO';

/** Chaque recherche sollicite le compte de service du site : dix essais par quart d'heure suffisent. */
export const bioSearchTooFast = (userId: string) =>
  !rateLimit(`recherche-profil:${userId}`, 10, 15 * 60_000);

/** Un nouveau code remplace le précédent : une seule vérification en cours par joueur. */
export async function startBioCheck(
  userId: string,
  provider: BioProvider,
  onlineId: string,
  accountId: string,
) {
  const data = {
    provider,
    onlineId,
    accountId,
    code: newPsnCode(),
    expiresAt: new Date(Date.now() + CODE_LIFETIME),
  };
  await db.psnVerification.upsert({
    where: { userId },
    update: data,
    create: { ...data, userId },
  });
}

/** La vérification en cours pour cette plateforme, si elle n'a pas expiré. */
export async function pendingBioCheck(userId: string, provider: BioProvider) {
  const pending = await db.psnVerification.findUnique({ where: { userId } });
  return pending?.provider === provider && pending.expiresAt >= new Date() ? pending : null;
}

/** Le code est sur le profil : le compte est lié, ou une fusion est proposée s'il a déjà un profil. */
export async function finishBioCheck(
  userId: string,
  cookies: Cookies,
  identity: Identity & { provider: BioProvider },
  linked: () => string,
) {
  const result = await resolveIdentity(identity, userId);
  if (!result.ok && result.reason === 'provider_taken') {
    return fail(409, { error: m.provider_taken() });
  }

  await db.psnVerification.delete({ where: { userId } });
  if (!result.ok) {
    saveMerge(cookies, {
      sourceId: result.ownerId,
      targetId: userId,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
    });
    return { success: m.psn_other_profile() };
  }

  await enqueueSync(userId, identity.provider);
  return { success: linked() };
}
