import type { AccountLook, Identity } from '../accounts';
import { env } from '../env';
import { countSteamCall } from '../steam-quota';
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

  countSteamCall(url);
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
    ...(await fetchSteamLook(steamId)),
    profileUrl: player?.profileurl ?? `https://steamcommunity.com/profiles/${steamId}`,
  };
}

export interface SteamSummary {
  /** Le jeu lancé en ce moment, s'il y en a un. */
  gameId?: string;
  avatarUrl?: string;
}

/**
 * Le suivi en direct et la page « jeu en cours » des profils demandent le même résumé, au même
 * rythme : une réponse plus jeune que ce délai sert aux deux, sans second appel.
 */
export const SUMMARY_MAX_AGE = 9_000;
const SUMMARY_BATCH = 100;
const summaryCache = new Map<string, { summary: SteamSummary; at: number }>();

async function requestSummaries(steamIds: string[]) {
  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  url.searchParams.set('key', env().STEAM_API_KEY ?? '');
  url.searchParams.set('steamids', steamIds.join(','));
  countSteamCall(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Steam a répondu ${response.status}`);
  const data = (await response.json()) as {
    response?: { players?: { steamid: string; gameid?: string; avatarfull?: string }[] };
  };
  const players = new Map(
    (data.response?.players ?? []).map((player) => [player.steamid, player] as const),
  );
  const at = Date.now();
  for (const steamId of steamIds) {
    const player = players.get(steamId);
    // Un joueur absent de la réponse est retenu aussi : il ne coûte pas un appel à chaque fois.
    const summary = { gameId: player?.gameid, avatarUrl: player?.avatarfull };
    summaryCache.set(steamId, { summary, at });
  }
}

/**
 * Le résumé public de chaque joueur, par SteamID, par lots de 100 joueurs par appel. Le jeu en
 * cours n'y figure que pour un profil public, et pas pour un joueur apparaissant hors ligne.
 */
export async function fetchSteamSummaries(steamIds: string[], maxAge = SUMMARY_MAX_AGE) {
  const now = Date.now();
  if (summaryCache.size > 5_000) {
    for (const [id, { at }] of summaryCache) if (now - at > 60_000) summaryCache.delete(id);
  }
  const stale = [...new Set(steamIds)].filter(
    (steamId) => now - (summaryCache.get(steamId)?.at ?? 0) > maxAge,
  );
  for (let index = 0; index < stale.length; index += SUMMARY_BATCH) {
    await requestSummaries(stale.slice(index, index + SUMMARY_BATCH));
  }
  return new Map(
    steamIds.flatMap((steamId) => {
      const cached = summaryCache.get(steamId);
      return cached ? [[steamId, cached.summary] as const] : [];
    }),
  );
}

/** Les jeux lancés en ce moment, par SteamID. */
export async function fetchPlayingGames(steamIds: string[], maxAge?: number) {
  const summaries = await fetchSteamSummaries(steamIds, maxAge);
  return new Map(
    [...summaries].flatMap(([steamId, { gameId }]) => (gameId ? [[steamId, gameId] as const] : [])),
  );
}

const STEAM_IMAGES = 'https://shared.fastly.steamstatic.com/community_assets/images/';

interface SteamItem {
  image_small?: string;
  image_large?: string;
}

const steamImage = (path: string | undefined) => (path ? `${STEAM_IMAGES}${path}` : null);

/**
 * Ces images sont un plus : une panne de Steam ne doit jamais empêcher de se connecter.
 * `null` veut dire « inconnu », à ne pas confondre avec un joueur sans cadre.
 */
export async function fetchSteamLook(steamId: string): Promise<AccountLook | null> {
  try {
    // Un seul appel pour tous les objets équipés, au lieu d'un par objet.
    const url = new URL('https://api.steampowered.com/IPlayerService/GetProfileItemsEquipped/v1/');
    url.searchParams.set('key', env().STEAM_API_KEY ?? '');
    url.searchParams.set('steamid', steamId);
    countSteamCall(url);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`GetProfileItemsEquipped a répondu ${response.status}`);
    const data = (await response.json()) as {
      response?: { animated_avatar?: SteamItem; avatar_frame?: SteamItem };
    };
    const items = data.response ?? {};
    return {
      avatarMotionUrl: steamImage(items.animated_avatar?.image_small),
      frameUrl: steamImage(items.avatar_frame?.image_large),
      frameMotionUrl: steamImage(items.avatar_frame?.image_small),
    };
  } catch {
    return null;
  }
}
