import type { Identity } from '../accounts';
import { pkceChallenge } from '../crypto';
import { env } from '../env';
import { callbackUrl, fetchOAuthProfile } from './index';

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
  const user = await fetchOAuthProfile<{ sub: string; name?: string; picture?: string }>(
    {
      name: 'Google',
      provider: 'google',
      tokenUrl: TOKEN,
      profileUrl: USERINFO,
      clientId: env().GOOGLE_CLIENT_ID,
      clientSecret: env().GOOGLE_CLIENT_SECRET,
    },
    code,
    verifier,
  );

  return {
    provider: 'GOOGLE',
    providerUserId: user.sub,
    displayName: user.name || 'Joueur',
    avatarUrl: user.picture ?? null,
  };
}
