import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  exchangeRefreshTokenForAuthTokens,
  getProfileFromUserName,
  type AuthorizationPayload,
} from 'psn-api';
import { randomBytes } from 'node:crypto';
import { env } from '../env';

interface ServiceTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let tokens: ServiceTokens | undefined;

const fromNpsso = async () =>
  exchangeAccessCodeForAuthTokens(await exchangeNpssoForAccessCode(env().PSN_SERVICE_NPSSO ?? ''));

/**
 * Autorisation du compte de service PSN.
 *
 * Le site n'utilise jamais le NPSSO d'un joueur : ce jeton vaut un mot de passe.
 * Le compte de service lit seulement les trophées que les joueurs laissent publics.
 */
export async function psnAuthorization(): Promise<AuthorizationPayload> {
  if (tokens && tokens.expiresAt > Date.now() + 60_000) return { accessToken: tokens.accessToken };

  const response = await (tokens
    ? exchangeRefreshTokenForAuthTokens(tokens.refreshToken).catch(fromNpsso)
    : fromNpsso());

  tokens = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: Date.now() + response.expiresIn * 1000,
  };
  return { accessToken: tokens.accessToken };
}

interface PsnProfile {
  accountId: string;
  onlineId: string;
  aboutMe: string;
  avatarUrl: string | null;
}

export async function findPsnProfile(onlineId: string): Promise<PsnProfile | null> {
  try {
    const { profile } = await getProfileFromUserName(await psnAuthorization(), onlineId);
    return {
      accountId: profile.accountId,
      onlineId: profile.onlineId,
      aboutMe: profile.aboutMe ?? '',
      avatarUrl: profile.avatarUrls?.at(-1)?.avatarUrl ?? null,
    };
  } catch (error) {
    if (error instanceof Error && /not found|2105356/i.test(error.message)) return null;
    throw error;
  }
}

/** Code à coller dans la bio PSN : prouve que le visiteur contrôle ce profil. */
export const newPsnCode = () => `PA-${randomBytes(3).toString('hex').toUpperCase()}`;

/** Le code doit être un mot entier : `PA-ABC123` ne valide pas `XPA-ABC1234`. */
export function bioContainsCode(aboutMe: string, code: string): boolean {
  return new RegExp(`(^|[^A-Z0-9-])${code}($|[^A-Z0-9-])`, 'i').test(aboutMe);
}
