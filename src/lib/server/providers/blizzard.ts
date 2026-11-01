import type { Identity } from '../accounts';
import { env } from '../env';
import { callbackUrl } from './index';

const OAUTH = 'https://oauth.battle.net';
const API = 'https://eu.api.blizzard.com';
const SCOPES = 'openid wow.profile sc2.profile';

const timeout = () => AbortSignal.timeout(10_000);

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

const fieldsOf = (value: unknown) =>
  value && typeof value === 'object' ? Object.keys(value) : typeof value;

/** Note ce que l'API donne vraiment : formes et nombres, jamais les valeurs ni le jeton. */
async function logAccess(token: string, accountId: string) {
  const read = async (path: string, namespace?: string) => {
    const url = new URL(`${API}${path}`);
    if (namespace) url.searchParams.set('namespace', namespace);
    url.searchParams.set('locale', 'en_GB');
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeout(),
    });
    const body: unknown = response.ok ? await response.json() : null;
    return { status: response.status, body };
  };

  const wow = await read('/profile/user/wow', 'profile-eu');
  const accounts =
    (
      wow.body as {
        wow_accounts?: { characters?: { name: string; realm: { slug: string } }[] }[];
      } | null
    )?.wow_accounts ?? [];
  const characters = accounts.flatMap((account) => account.characters ?? []);
  console.info('Blizzard, WoW :', {
    status: wow.status,
    fields: fieldsOf(wow.body),
    accounts: accounts.length,
    characters: characters.length,
  });

  const [first] = characters;
  if (first) {
    const name = encodeURIComponent(first.name.toLowerCase());
    const path = `/profile/wow/character/${first.realm.slug}/${name}/achievements`;
    const done = await read(path, 'profile-eu');
    const list = (done.body as { achievements?: unknown[]; total_quantity?: number } | null) ?? {};
    console.info('Blizzard, succès WoW :', {
      status: done.status,
      fields: fieldsOf(done.body),
      total: list.total_quantity,
      count: list.achievements?.length,
      entry: fieldsOf(list.achievements?.[0]),
    });
  }

  const sc2 = await read(`/sc2/player/${accountId}`);
  const profiles = Array.isArray(sc2.body) ? sc2.body : [];
  console.info('Blizzard, SC2 :', {
    status: sc2.status,
    profiles: profiles.length,
    entry: fieldsOf(profiles[0]),
  });

  const [profile] = profiles as { regionId: number; realmId: number; profileId: string }[];
  if (profile) {
    const path = `/sc2/profile/${profile.regionId}/${profile.realmId}/${profile.profileId}`;
    const detail = await read(path);
    const earned = (detail.body as { earnedAchievements?: unknown[] } | null)?.earnedAchievements;
    console.info('Blizzard, succès SC2 :', {
      status: detail.status,
      fields: fieldsOf(detail.body),
      earned: earned?.length,
      entry: fieldsOf(earned?.[0]),
    });
  }
}

/** Battle.net ne sert pour l'instant qu'à mesurer ce que l'API renvoie : aucun jeton n'est conservé. */
export async function exchangeBlizzardCode(code: string): Promise<Identity> {
  const { BLIZZARD_CLIENT_ID: id, BLIZZARD_CLIENT_SECRET: secret } = env();
  const tokenResponse = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl('blizzard'),
      scope: SCOPES,
    }),
    signal: timeout(),
  });
  if (!tokenResponse.ok) throw new Error(`Blizzard a refusé le code (${tokenResponse.status})`);
  const tokens = (await tokenResponse.json()) as { access_token: string; scope?: string };
  console.info('Blizzard, jeton :', { fields: Object.keys(tokens), scope: tokens.scope });

  const userResponse = await fetch(`${OAUTH}/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: timeout(),
  });
  if (!userResponse.ok) throw new Error(`Profil Blizzard illisible (${userResponse.status})`);
  const user = (await userResponse.json()) as { sub: string; battletag?: string };
  console.info('Blizzard, profil :', { fields: Object.keys(user) });

  await logAccess(tokens.access_token, user.sub).catch((cause) =>
    console.error('Blizzard, exploration :', cause),
  );

  return {
    provider: 'BLIZZARD',
    providerUserId: user.sub,
    displayName: user.battletag || 'Battle.net',
    avatarUrl: null,
    profileUrl: null,
  };
}
