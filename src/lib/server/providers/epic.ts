import type { Identity } from '../accounts';
import { env } from '../env';
import { callbackUrl } from './index';
import { basicAuth, exchangeCodeForProfile } from './oauth';

const AUTHORIZE = 'https://www.epicgames.com/id/authorize';
const API = 'https://api.epicgames.dev/epic';
const SCOPES = 'basic_profile friends_list presence country';

export function epicAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env().EPIC_CLIENT_ID ?? '',
    redirect_uri: callbackUrl('epic'),
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE}?${params}`;
}

/** Epic ne fournit pas de succès ici : ce compte prouve seulement l'identité du joueur. */
export async function exchangeEpicCode(code: string): Promise<Identity> {
  const { EPIC_CLIENT_ID: id, EPIC_CLIENT_SECRET: secret } = env();
  const { profile: user } = await exchangeCodeForProfile<{
    sub: string;
    preferred_username?: string;
  }>({
    name: 'Epic',
    tokenUrl: `${API}/oauth/v2/token`,
    profileUrl: `${API}/oauth/v2/userInfo`,
    authorization: basicAuth(id, secret),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl('epic'),
    }),
  });

  return {
    provider: 'EPIC',
    providerUserId: user.sub,
    displayName: user.preferred_username || 'Epic',
    avatarUrl: null,
    profileUrl: `https://store.epicgames.com/u/${user.sub}`,
  };
}
