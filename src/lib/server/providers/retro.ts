import { env } from '../env';
import { fetchRetry } from '../sync/errors';

const API = 'https://retroachievements.org/API';
export const RETRO_MEDIA = 'https://media.retroachievements.org';

/** Une clé de site suffit : le site ne demande jamais le mot de passe d'un joueur. */
export async function retroGet(endpoint: string, params: Record<string, string | number>) {
  const url = new URL(`${API}/${endpoint}`);
  url.searchParams.set('y', env().RETRO_API_KEY ?? '');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return fetchRetry(url);
}

interface RetroProfile {
  /** Stable, contrairement au pseudo qui peut changer. */
  ulid: string;
  username: string;
  motto: string;
  avatarUrl: string | null;
}

export async function findRetroProfile(username: string): Promise<RetroProfile | null> {
  const response = await retroGet('API_GetUserProfile.php', { u: username });
  if (response.status === 404 || response.status === 422) return null;
  if (!response.ok) throw new Error(`RetroAchievements a répondu ${response.status}`);
  const profile = (await response.json()) as {
    User?: string;
    ULID?: string;
    UserPic?: string;
    Motto?: string;
  } | null;
  if (!profile?.ULID || !profile.User) return null;
  return {
    ulid: profile.ULID,
    username: profile.User,
    motto: profile.Motto ?? '',
    avatarUrl: profile.UserPic ? `${RETRO_MEDIA}${profile.UserPic}` : null,
  };
}
