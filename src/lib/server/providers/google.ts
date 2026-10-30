import type { Identity } from '../accounts';
import { pkceChallenge } from '../crypto';
import { env } from '../env';
import { callbackUrl } from './index';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

export function googleAuthorizeUrl(state: string, verifier: string): string {
  const params = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID ?? '',
    redirect_uri: callbackUrl('google'),
    response_type: 'code',
    scope: 'openid profile',
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE}?${params}`;
}

/** Google ne sert qu'à se connecter : aucun jeton n'est conservé. */
export async function exchangeGoogleCode(code: string, verifier: string): Promise<Identity> {
  const tokenResponse = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env().GOOGLE_CLIENT_ID ?? '',
      client_secret: env().GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: callbackUrl('google'),
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Google a refusé le code (${tokenResponse.status})`);
  const tokens = (await tokenResponse.json()) as { access_token: string };

  const userResponse = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) throw new Error(`Profil Google illisible (${userResponse.status})`);
  const user = (await userResponse.json()) as { sub: string; name?: string; picture?: string };

  return {
    provider: 'GOOGLE',
    providerUserId: user.sub,
    displayName: user.name || 'Joueur',
    avatarUrl: user.picture ?? null,
  };
}
