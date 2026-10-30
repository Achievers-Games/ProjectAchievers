import type { Identity } from '../accounts';
import { env } from '../env';
import { callbackUrl } from './index';

const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function steamAuthorizeUrl(state: string): string {
  const returnTo = new URL(callbackUrl('steam'));
  returnTo.searchParams.set('state', state);
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo.toString(),
    'openid.realm': env().ORIGIN,
    'openid.claimed_id': IDENTIFIER_SELECT,
    'openid.identity': IDENTIFIER_SELECT,
  });
  return `${OPENID_ENDPOINT}?${params}`;
}

/**
 * Vérifie une réponse OpenID et renvoie le SteamID64, ou null.
 *
 * La signature n'est vérifiée que par Steam : le `return_to`, le point de terminaison
 * et le `claimed_id` doivent donc être contrôlés ici, avant de lui poser la question.
 */
export async function verifySteamResponse(query: URLSearchParams): Promise<string | null> {
  if (query.get('openid.mode') !== 'id_res') return null;
  if (query.get('openid.op_endpoint') !== OPENID_ENDPOINT) return null;

  const returnTo = query.get('openid.return_to') ?? '';
  const expected = callbackUrl('steam');
  if (returnTo !== expected && !returnTo.startsWith(`${expected}?`)) return null;

  const signed = query.get('openid.signed')?.split(',') ?? [];
  if (!['claimed_id', 'identity', 'return_to', 'response_nonce'].every((f) => signed.includes(f))) {
    return null;
  }

  const steamId = CLAIMED_ID.exec(query.get('openid.claimed_id') ?? '')?.[1];
  if (!steamId) return null;

  const body = new URLSearchParams();
  for (const [key, value] of query) if (key.startsWith('openid.')) body.append(key, value);
  body.set('openid.mode', 'check_authentication');

  const response = await fetch(OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return /^is_valid:true$/m.test(text) ? steamId : null;
}

export async function fetchSteamIdentity(steamId: string): Promise<Identity> {
  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  url.searchParams.set('key', env().STEAM_API_KEY ?? '');
  url.searchParams.set('steamids', steamId);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Steam a répondu ${response.status}`);
  const data = (await response.json()) as {
    response?: { players?: { personaname?: string; avatarfull?: string; profileurl?: string }[] };
  };
  const player = data.response?.players?.[0];

  return {
    provider: 'STEAM',
    providerUserId: steamId,
    displayName: player?.personaname || `Steam ${steamId.slice(-5)}`,
    avatarUrl: player?.avatarfull,
    profileUrl: player?.profileurl ?? `https://steamcommunity.com/profiles/${steamId}`,
  };
}
