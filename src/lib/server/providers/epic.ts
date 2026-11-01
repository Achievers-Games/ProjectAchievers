import type { Identity } from '../accounts';
import { env } from '../env';
import { callbackUrl } from './index';

const AUTHORIZE = 'https://www.epicgames.com/id/authorize';
const API = 'https://api.epicgames.dev/epic';
const SCOPES = 'basic_profile friends_list presence country';

const timeout = () => AbortSignal.timeout(10_000);

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

/** Note ce qu'Epic donne vraiment : seulement les noms de champs, jamais les valeurs ni le jeton. */
async function logAccess(accessToken: string, accountId: string) {
  const friends = await fetch(`${API}/friends/v1/${accountId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: timeout(),
  });
  const body: unknown = friends.ok ? await friends.json() : null;
  console.info('Epic, amis :', {
    status: friends.status,
    count: Array.isArray(body) ? body.length : undefined,
    fields: Array.isArray(body) ? Object.keys(body[0] ?? {}) : Object.keys(body ?? {}),
  });
}

/** Epic ne fournit pas de succès ici : ce compte prouve seulement l'identité du joueur. */
export async function exchangeEpicCode(code: string): Promise<Identity> {
  const { EPIC_CLIENT_ID: id, EPIC_CLIENT_SECRET: secret } = env();
  const tokenResponse = await fetch(`${API}/oauth/v2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl('epic'),
    }),
    signal: timeout(),
  });
  if (!tokenResponse.ok) throw new Error(`Epic a refusé le code (${tokenResponse.status})`);
  const tokens = (await tokenResponse.json()) as { access_token: string; scope?: string };
  console.info('Epic, jeton :', { fields: Object.keys(tokens), scope: tokens.scope });

  const userResponse = await fetch(`${API}/oauth/v2/userInfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: timeout(),
  });
  if (!userResponse.ok) throw new Error(`Profil Epic illisible (${userResponse.status})`);
  const user = (await userResponse.json()) as { sub: string; preferred_username?: string };
  console.info('Epic, profil :', { fields: Object.keys(user) });

  await logAccess(tokens.access_token, user.sub).catch((cause) =>
    console.error('Epic, amis :', cause),
  );

  return {
    provider: 'EPIC',
    providerUserId: user.sub,
    displayName: user.preferred_username || 'Epic',
    avatarUrl: null,
    profileUrl: `https://store.epicgames.com/u/${user.sub}`,
  };
}
