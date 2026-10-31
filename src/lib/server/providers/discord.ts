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

/** Discord ne sert qu'à se connecter : aucun jeton n'est conservé. */
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
  const tokens = (await tokenResponse.json()) as { access_token: string };

  const userResponse = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) throw new Error(`Profil Discord illisible (${userResponse.status})`);
  const user = (await userResponse.json()) as DiscordUser & {
    username: string;
    global_name: string | null;
  };

  return {
    provider: 'DISCORD',
    providerUserId: user.id,
    displayName: user.global_name || user.username,
    ...discordLook(user),
    profileUrl: `https://discord.com/users/${user.id}`,
  };
}

export interface DiscordUser {
  id: string;
  avatar: string | null;
  avatar_decoration_data?: { asset: string } | null;
}

export function discordLook(user: DiscordUser) {
  const decoration = user.avatar_decoration_data?.asset;
  const avatars = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`;
  const decorationUrl = (animated: boolean) =>
    `https://cdn.discordapp.com/avatar-decoration-presets/${decoration}.png?size=160&passthrough=${animated}`;

  return {
    avatarUrl: user.avatar ? `${avatars}.png?size=128` : null,
    // Discord marque ses avatars animés par ce préfixe.
    avatarMotionUrl: user.avatar?.startsWith('a_') ? `${avatars}.gif?size=128` : null,
    frameUrl: decoration ? decorationUrl(false) : null,
    frameMotionUrl: decoration ? decorationUrl(true) : null,
  };
}
