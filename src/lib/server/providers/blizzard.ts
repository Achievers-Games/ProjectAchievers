import type { BlizzardCharacter, Identity } from '../accounts';
import { env } from '../env';
import { logger } from '$lib/logger';
import { fetchRetry } from '../sync/errors';
import { callbackUrl } from './index';
import { basicAuth, exchangeCodeForProfile } from './oauth';

const log = logger('Blizzard');

const OAUTH = 'https://oauth.battle.net';
const SCOPES = 'openid wow.profile sc2.profile';
/** Chaque région a ses propres personnages WoW : aucune adresse ne les réunit. */
const REGIONS = ['eu', 'us', 'kr', 'tw'];

const secrets = () => {
  const { BLIZZARD_CLIENT_ID: id, BLIZZARD_CLIENT_SECRET: secret } = env();
  return { id, secret };
};

export function blizzardAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env().BLIZZARD_CLIENT_ID ?? '',
    redirect_uri: callbackUrl('blizzard'),
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `${OAUTH}/authorize?${params}`;
}

let appToken: { value: string; expiresAt: number } | null = null;

/** Un jeton du site, pas d'un joueur : les profils se relisent sans qu'il revienne. */
async function siteToken() {
  if (appToken && appToken.expiresAt > Date.now()) return appToken.value;
  const response = await fetchRetry(`${OAUTH}/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(secrets().id, secrets().secret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`Blizzard a refusé le jeton du site (${response.status})`);
  const { access_token: value, expires_in: lifetime } = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  appToken = { value, expiresAt: Date.now() + (lifetime - 60) * 1000 };
  return value;
}

export async function blizzardGet(
  path: string,
  params: Record<string, string> = {},
  region = 'eu',
) {
  const url = new URL(`https://${region}.api.blizzard.com${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetchRetry(url, { headers: { Authorization: `Bearer ${await siteToken()}` } });
}

interface WowAccounts {
  wow_accounts?: { characters?: { name: string; realm: { slug: string } }[] }[];
}

/** La liste des personnages n'existe qu'avec le jeton du joueur, donc seulement à la liaison. */
async function fetchCharacters(token: string): Promise<BlizzardCharacter[] | undefined> {
  try {
    const regions = await Promise.all(
      REGIONS.map(async (region) => {
        const url = new URL(`https://${region}.api.blizzard.com/profile/user/wow`);
        url.searchParams.set('namespace', `profile-${region}`);
        const response = await fetchRetry(url, { headers: { Authorization: `Bearer ${token}` } });
        // Un 404 veut dire « aucun compte WoW dans cette région ».
        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`WoW a répondu ${response.status} (${region})`);
        const { wow_accounts: accounts = [] } = (await response.json()) as WowAccounts;
        return accounts.flatMap((account) =>
          (account.characters ?? []).map(({ name, realm }) => ({
            region,
            realm: realm.slug,
            name: name.toLowerCase(),
          })),
        );
      }),
    );
    return regions.flat();
  } catch (cause) {
    // La liste connue reste en place : un incident ne doit pas faire oublier les personnages.
    log.error('Personnages WoW :', cause);
    return undefined;
  }
}

export async function exchangeBlizzardCode(code: string): Promise<Identity> {
  const { id, secret } = secrets();
  const { token, profile: user } = await exchangeCodeForProfile<{
    sub: string;
    battletag?: string;
  }>({
    name: 'Blizzard',
    tokenUrl: `${OAUTH}/token`,
    profileUrl: `${OAUTH}/userinfo`,
    authorization: basicAuth(id, secret),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl('blizzard'),
      scope: SCOPES,
    }),
  });

  return {
    provider: 'BLIZZARD',
    providerUserId: user.sub,
    displayName: user.battletag || 'Battle.net',
    avatarUrl: null,
    profileUrl: null,
    characters: await fetchCharacters(token),
  };
}
