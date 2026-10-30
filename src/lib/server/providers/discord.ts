import type { Identity } from '../accounts';
import { pkceChallenge } from '../crypto';
import { env } from '../env';
import { callbackUrl } from './index';

const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const API = 'https://discord.com/api/v10';

export function discordAuthorizeUrl(state: string, verifier: string): string {
  const params = new URLSearchParams({
    client_id: env().DISCORD_CLIENT_ID ?? '',
    redirect_uri: callbackUrl('discord'),
    response_type: 'code',
    scope: 'identify',
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE}?${params}`;
}

export async function exchangeDiscordCode(code: string, verifier: string): Promise<Identity> {
  const tokenResponse = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env().DISCORD_CLIENT_ID ?? '',
      client_secret: env().DISCORD_CLIENT_SECRET ?? '',
      redirect_uri: callbackUrl('discord'),
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Discord a refusé le code (${tokenResponse.status})`);
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const userResponse = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) throw new Error(`Profil Discord illisible (${userResponse.status})`);
  const user = (await userResponse.json()) as {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  };

  return {
    provider: 'DISCORD',
    providerUserId: user.id,
    displayName: user.global_name || user.username,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : null,
    profileUrl: `https://discord.com/users/${user.id}`,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  };
}
