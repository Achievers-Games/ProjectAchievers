import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  exchangeRefreshTokenForAuthTokens,
  getProfileFromUserName,
  type AuthorizationPayload,
} from 'psn-api';
import { randomBytes } from 'node:crypto';
import { env } from '../env';
import { notePsnToken } from '../service-token';

interface ServiceTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let tokens: ServiceTokens | undefined;

/** Seul le refus du NPSSO compte comme un jeton mort : une panne réseau ne dit rien de lui. */
async function fromNpsso() {
  const npsso = env().PSN_SERVICE_NPSSO ?? '';
  let code: string;
  try {
    code = await exchangeNpssoForAccessCode(npsso);
  } catch (error) {
    if (npsso && error instanceof Error && /npsso/i.test(error.message)) {
      await notePsnToken(npsso, error.message).catch(() => {});
    }
    throw error;
  }
  const response = await exchangeAccessCodeForAuthTokens(code);
  await notePsnToken(npsso).catch(() => {});
  return response;
}

/**
 * Autorisation du compte de service PSN.
 *
 * Le site n'utilise jamais le NPSSO d'un joueur : ce jeton vaut un mot de passe.
 * Le compte de service lit seulement les trophées que les joueurs laissent publics.
 */
export async function psnAuthorization(): Promise<AuthorizationPayload> {
  if (tokens && tokens.expiresAt > Date.now() + 60_000) return { accessToken: tokens.accessToken };
  // Deux jeux lus de front demandaient chacun un nouveau jeton avec le même rafraîchissement,
  // que Sony n'accepte qu'une fois : tous attendent désormais le même échange.
  refreshing ??= renewTokens().finally(() => {
    refreshing = undefined;
  });
  return { accessToken: (await refreshing).accessToken };
}

let refreshing: Promise<ServiceTokens> | undefined;

async function renewTokens() {
  const response = await (tokens
    ? exchangeRefreshTokenForAuthTokens(tokens.refreshToken).catch(fromNpsso)
    : fromNpsso());

  tokens = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: Date.now() + response.expiresIn * 1000,
  };
  return tokens;
}

interface PsnProfile {
  accountId: string;
  onlineId: string;
  aboutMe: string;
  avatarUrl: string | null;
}

/** La recherche du compte retourne souvent sur le même pseudo ; la preuve de bio, jamais en cache. */
const PROFILE_TTL = 10 * 60_000;
const MAX_PROFILES = 500;
const profiles = new Map<string, { profile: PsnProfile; at: number }>();

export async function findPsnProfile(onlineId: string, fresh = false): Promise<PsnProfile | null> {
  if (!fresh) {
    const cached = profiles.get(onlineId);
    if (cached && Date.now() - cached.at < PROFILE_TTL) return cached.profile;
  }
  try {
    const { profile } = await getProfileFromUserName(await psnAuthorization(), onlineId);
    const found: PsnProfile = {
      accountId: profile.accountId,
      onlineId: profile.onlineId,
      aboutMe: profile.aboutMe ?? '',
      avatarUrl: profile.avatarUrls?.at(-1)?.avatarUrl ?? null,
    };
    profiles.set(onlineId, { profile: found, at: Date.now() });
    // Les pseudos viennent des visiteurs : sans plafond, le cache grossirait sans fin.
    if (profiles.size > MAX_PROFILES) profiles.delete(profiles.keys().next().value as string);
    return found;
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
