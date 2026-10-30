import type { Identity } from '../accounts';
import { pkceChallenge } from '../crypto';
import { env } from '../env';
import { callbackUrl } from './index';

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin XboxLive.offline_access offline_access';

export interface XboxSession {
  /** En-tête d'autorisation des API Xbox Live. */
  authorization: string;
  xuid: string;
  gamertag: string;
}

interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export function xboxAuthorizeUrl(state: string, verifier: string): string {
  const params = new URLSearchParams({
    client_id: env().XBOX_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri: callbackUrl('xbox'),
    scope: SCOPE,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `${AUTHORITY}/authorize?${params}`;
}

async function requestTokens(grant: Record<string, string>): Promise<MicrosoftTokens> {
  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env().XBOX_CLIENT_ID ?? '',
      client_secret: env().XBOX_CLIENT_SECRET ?? '',
      scope: SCOPE,
      ...grant,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Microsoft a refusé la demande (${response.status})`);
  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  };
}

export const refreshMicrosoftTokens = (refreshToken: string) =>
  requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });

async function xboxPost<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-xbl-contract-version': '1',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Xbox Live a refusé l'authentification (${response.status})`);
  return (await response.json()) as T;
}

/** Échange un jeton Microsoft contre un jeton utilisateur Xbox, puis un jeton XSTS. */
export async function openXboxSession(microsoftAccessToken: string): Promise<XboxSession> {
  const user = await xboxPost<{ Token: string }>(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${microsoftAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
  );

  const xsts = await xboxPost<{
    Token: string;
    DisplayClaims: { xui: { uhs: string; xid?: string; gtg?: string }[] };
  }>('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [user.Token] },
    RelyingParty: 'http://xboxlive.com',
    TokenType: 'JWT',
  });

  const claims = xsts.DisplayClaims.xui[0];
  if (!claims?.xid) throw new Error('Identité Xbox absente de la réponse');

  return {
    authorization: `XBL3.0 x=${claims.uhs};${xsts.Token}`,
    xuid: claims.xid,
    gamertag: claims.gtg ?? `Xbox ${claims.xid.slice(-5)}`,
  };
}

export async function exchangeXboxCode(code: string, verifier: string): Promise<Identity> {
  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl('xbox'),
    code_verifier: verifier,
  });
  const session = await openXboxSession(tokens.accessToken);

  return {
    provider: 'XBOX',
    providerUserId: session.xuid,
    displayName: session.gamertag,
    profileUrl: `https://www.xbox.com/play/user/${encodeURIComponent(session.gamertag)}`,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.expiresAt,
  };
}
