import type { Cookies } from '@sveltejs/kit';
import { psnNpsso } from '../psn-npsso';
import type { Provider } from '#prisma';
import { secureCookie } from '../cookies';
import { decrypt, encrypt } from '../crypto';
import { env } from '../env';
import { exchangeCodeForProfile } from './oauth';

export type OAuthProvider = 'steam' | 'discord' | 'xbox' | 'google' | 'epic' | 'blizzard';

export const OAUTH_PROVIDERS: Record<OAuthProvider, Provider> = {
  steam: 'STEAM',
  discord: 'DISCORD',
  xbox: 'XBOX',
  google: 'GOOGLE',
  epic: 'EPIC',
  blizzard: 'BLIZZARD',
};

export function availableProviders(): Record<Provider, boolean> {
  const e = env();
  return {
    STEAM: Boolean(e.STEAM_API_KEY),
    DISCORD: Boolean(e.DISCORD_CLIENT_ID && e.DISCORD_CLIENT_SECRET),
    XBOX: Boolean(e.XBOX_CLIENT_ID && e.XBOX_CLIENT_SECRET),
    PSN: Boolean(psnNpsso()),
    RETRO: Boolean(e.RETRO_API_KEY),
    EPIC: Boolean(e.EPIC_CLIENT_ID && e.EPIC_CLIENT_SECRET),
    BLIZZARD: Boolean(e.BLIZZARD_CLIENT_ID && e.BLIZZARD_CLIENT_SECRET),
    GOOGLE: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
  };
}

export const callbackUrl = (provider: OAuthProvider) => `${env().ORIGIN}/auth/${provider}/callback`;

interface CodeExchange {
  name: string;
  provider: OAuthProvider;
  tokenUrl: string;
  profileUrl: string;
  clientId?: string;
  clientSecret?: string;
}

/** Échange un code d'autorisation contre le profil du joueur ; aucun jeton n'est conservé. */
export async function fetchOAuthProfile<T>(flow: CodeExchange, code: string, verifier: string) {
  // Discord et Google lisent l'identité du site dans le corps, avec PKCE ; Epic et Blizzard dans
  // l'en-tête. L'échange lui-même est le même pour tous.
  const { profile } = await exchangeCodeForProfile<T>({
    name: flow.name,
    tokenUrl: flow.tokenUrl,
    profileUrl: flow.profileUrl,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: flow.clientId ?? '',
      client_secret: flow.clientSecret ?? '',
      redirect_uri: callbackUrl(flow.provider),
      code_verifier: verifier,
    }),
  });
  return profile;
}

const FLOW_COOKIE = 'pa_oauth';

interface OAuthFlow {
  provider: OAuthProvider;
  state: string;
  verifier?: string;
  returnTo: string;
}

/** Le contexte du flux reste chez le navigateur, chiffré, pendant 10 minutes. */
export function saveFlow(cookies: Cookies, flow: OAuthFlow) {
  cookies.set(FLOW_COOKIE, encrypt(JSON.stringify(flow)), {
    ...secureCookie,
    path: '/auth',
    maxAge: 600,
  });
}

/** Lit le contexte et le consomme : un `state` ne sert qu'une fois. */
export function takeFlow(cookies: Cookies, provider: OAuthProvider, state: string | null) {
  const sealed = cookies.get(FLOW_COOKIE);
  cookies.delete(FLOW_COOKIE, { path: '/auth' });
  if (!sealed || !state) return null;
  try {
    const flow = JSON.parse(decrypt(sealed)) as OAuthFlow;
    return flow.provider === provider && flow.state === state ? flow : null;
  } catch {
    return null;
  }
}

/** N'accepte qu'un chemin interne, pour éviter les redirections ouvertes. */
export function safeReturnTo(value: string | null | undefined, fallback = '/compte'): string {
  return value && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : fallback;
}
