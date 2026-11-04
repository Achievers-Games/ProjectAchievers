const timeout = () => AbortSignal.timeout(10_000);

export const basicAuth = (id: string | undefined, secret: string | undefined) =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

const request = async (url: string, init: RequestInit, failure: (status: number) => string) => {
  const response = await fetch(url, { ...init, signal: timeout() });
  if (!response.ok) throw new Error(failure(response.status));
  return response;
};

/**
 * Échange un code OAuth2 contre le jeton du joueur, puis lit son profil : Epic et Blizzard
 * suivent le même schéma, seul le nom dans les erreurs change.
 */
export async function exchangeCodeForProfile<T>(options: {
  name: string;
  tokenUrl: string;
  profileUrl: string;
  authorization: string;
  body: URLSearchParams;
}): Promise<{ token: string; profile: T }> {
  const tokenResponse = await request(
    options.tokenUrl,
    {
      method: 'POST',
      headers: {
        Authorization: options.authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: options.body,
    },
    (status) => `${options.name} a refusé le code (${status})`,
  );
  const { access_token: token } = (await tokenResponse.json()) as { access_token: string };

  const profileResponse = await request(
    options.profileUrl,
    { headers: { Authorization: `Bearer ${token}` } },
    (status) => `Profil ${options.name} illisible (${status})`,
  );
  return { token, profile: (await profileResponse.json()) as T };
}
