import type { Cookies } from '@sveltejs/kit';
import type { Provider } from '@prisma/client';
import { decrypt, encrypt } from '../crypto';
import { env } from '../env';

export type OAuthProvider = 'steam' | 'discord' | 'xbox';

export const OAUTH_PROVIDERS: Record<OAuthProvider, Provider> = {
  steam: 'STEAM',
  discord: 'DISCORD',
  xbox: 'XBOX',
};

export function availableProviders(): Record<Provider, boolean> {
  const e = env();
  return {
    STEAM: Boolean(e.STEAM_API_KEY),
    DISCORD: Boolean(e.DISCORD_CLIENT_ID && e.DISCORD_CLIENT_SECRET),
    XBOX: Boolean(e.XBOX_CLIENT_ID && e.XBOX_CLIENT_SECRET),
    PSN: Boolean(e.PSN_SERVICE_NPSSO),
  };
}

export const callbackUrl = (provider: OAuthProvider) =>
  `${env().ORIGIN}/auth/${provider}/callback`;

const FLOW_COOKIE = 'pa_oauth';

export interface OAuthFlow {
  provider: OAuthProvider;
  state: string;
  verifier?: string;
  returnTo: string;
}

/** Le contexte du flux reste chez le navigateur, chiffré, pendant 10 minutes. */
export function saveFlow(cookies: Cookies, flow: OAuthFlow) {
  cookies.set(FLOW_COOKIE, encrypt(JSON.stringify(flow)), {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
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
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }
  return value;
}
