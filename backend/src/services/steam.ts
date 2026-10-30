import axios from 'axios';
import { prisma } from '../index.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_COMMUNITY_BASE = 'https://steamcommunity.com';

interface SteamOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface SteamUserSummary {
  steamid: string;
  personaname: string;
  avatarfull: string;
  profileurl: string;
  email?: string;
  loccountrycode?: string;
}

interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever?: number;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  img_icon_url: string;
  img_logo_url: string;
  has_community_visible_stats: boolean;
}

interface SteamGameSchema {
  game_name: string;
  game_version: string;
  available_game_stats: {
    achievements: SteamAchievementDefinition[];
  };
}

interface SteamAchievementDefinition {
  name: string;
  defaultvalue: number;
  displayname: string;
  hidden: number;
  description: string;
  icon: string;
  icongray: string;
}

interface SteamPlayerAchievement {
  apiname: string;
  achieved: number;
  unlocktime?: number;
}

interface SteamGlobalAchievement {
  name: string;
  percent: number;
}

interface SteamResolvedProfile {
  steamid: string;
  personaname: string;
  avatar: string;
  profileurl: string;
}

const STEAM_CLIENT_ID = process.env.STEAM_CLIENT_ID!;
const STEAM_CLIENT_SECRET = process.env.STEAM_CLIENT_SECRET!;
const STEAM_REDIRECT_URI = process.env.STEAM_REDIRECT_URI!;
const STEAM_API_KEY = process.env.STEAM_API_KEY!;
const STEAM_OPENID_REALM = process.env.STEAM_OPENID_REALM!;
const STEAM_OPENID_RETURN_TO = process.env.STEAM_OPENID_RETURN_TO!;

function getClient() {
  return axios.create({
    baseURL: STEAM_API_BASE,
    timeout: 10000,
  });
}

function getCommunityClient() {
  return axios.create({
    baseURL: STEAM_COMMUNITY_BASE,
    timeout: 10000,
  });
}

export async function generateSteamOpenIDUrl(state: string): Promise<string> {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': STEAM_OPENID_RETURN_TO,
    'openid.realm': STEAM_OPENID_REALM,
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.state': state,
  });

  return `${STEAM_COMMUNITY_BASE}/openid/login?${params.toString()}`;
}

export async function verifySteamOpenID(params: Record<string, string>): Promise<string | null> {
  // Verify the OpenID response with Steam
  const verificationParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    verificationParams.append(key, value);
  }
  verificationParams.set('openid.mode', 'check_authentication');

  try {
    const response = await getCommunityClient().post('/openid/login', verificationParams.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.data.includes('is_valid:true')) {
      return null;
    }

    // Extract SteamID from claimed_id
    const claimedId = params['openid.claimed_id'];
    if (!claimedId) return null;

    const match = claimedId.match(/https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)/);
    return match ? match[1] : null;
  } catch (error) {
    console.error('Steam OpenID verification failed:', error);
    return null;
  }
}

export async function exchangeSteamCodeForTokens(code: string, redirectUri: string): Promise<SteamOAuthTokens> {
  const response = await getClient().post('/oauth2/token', new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: STEAM_CLIENT_ID,
    client_secret: STEAM_CLIENT_SECRET,
    redirect_uri: redirectUri,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data;
}

export async function refreshSteamTokens(refreshToken: string): Promise<SteamOAuthTokens> {
  const response = await getClient().post('/oauth2/token', new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: STEAM_CLIENT_ID,
    client_secret: STEAM_CLIENT_SECRET,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data;
}

export async function revokeSteamToken(accessToken: string): Promise<void> {
  try {
    await getClient().post('/oauth2/revoke', new URLSearchParams({
      token: accessToken,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (error) {
    console.warn('Failed to revoke Steam token:', error);
  }
}

export async function getSteamUserSummary(accessToken: string): Promise<SteamUserSummary> {
  const response = await getClient().get('/ISteamUser/GetPlayerSummaries/v2/', {
    params: { access_token: accessToken },
  });

  const player = response.data.response?.players?.[0];
  if (!player) {
    throw new Error('Steam user not found');
  }

  return player;
}

export async function getOwnedGames(accessToken: string): Promise<SteamOwnedGame[]> {
  const response = await getClient().get('/IPlayerService/GetOwnedGames/v1/', {
    params: {
      access_token: accessToken,
      include_appinfo: true,
      include_played_free_games: true,
    },
  });

  return response.data.response?.games || [];
}

export async function getGameSchema(accessToken: string, appId: number): Promise<SteamGameSchema> {
  const response = await getClient().get('/ISteamUserStats/GetSchemaForGame/v2/', {
    params: { key: STEAM_API_KEY, appid: appId },
  });

  return response.data.game;
}

export async function getPlayerAchievements(accessToken: string, appId: number): Promise<SteamPlayerAchievement[]> {
  const response = await getClient().get('/ISteamUserStats/GetPlayerAchievements/v1/', {
    params: { access_token: accessToken, appid: appId },
  });

  return response.data.playerstats?.achievements || [];
}

export async function getGlobalAchievementPercentages(appId: number): Promise<SteamGlobalAchievement[]> {
  const response = await getClient().get('/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/', {
    params: { gameid: appId },
  });

  return response.data.achievementpercentages?.achievements || [];
}

export async function resolveVanity(profile: string): Promise<SteamResolvedProfile | null> {
  // Check if it's already a SteamID64
  if (/^\d{17}$/.test(profile)) {
    const summary = await getClient().get('/ISteamUser/GetPlayerSummaries/v2/', {
      params: { key: STEAM_API_KEY, steamids: profile },
    });
    const player = summary.data.response?.players?.[0];
    if (player) return player;
    return null;
  }

  // Try to resolve vanity URL
  try {
    const response = await getClient().get('/ISteamUser/ResolveVanityURL/v1/', {
      params: { key: STEAM_API_KEY, vanityurl: profile },
    });

    if (response.data.response?.success === 1) {
      const steamid = response.data.response.steamid;
      const summary = await getClient().get('/ISteamUser/GetPlayerSummaries/v2/', {
        params: { key: STEAM_API_KEY, steamids: steamid },
      });
      return summary.data.response?.players?.[0] || null;
    }
  } catch (error) {
    console.error('Failed to resolve vanity:', error);
  }

  return null;
}

export async function syncUserSteamData(userId: string, accessToken: string, refreshToken: string, steamId: string): Promise<{ gamesSynced: number; achievementsSynced: number; errors: string[] }> {
  const errors: string[] = [];
  let gamesSynced = 0;
  let achievementsSynced = 0;

  try {
    // Get owned games
    const ownedGames = await getOwnedGames(accessToken);

    for (const game of ownedGames) {
      if (!game.has_community_visible_stats) continue;

      try {
        // Upsert game
        const gameRecord = await prisma.game.upsert({
          where: { steamAppId: game.appid },
          update: {
            name: game.name,
            coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
            headerUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`,
            updatedAt: new Date(),
          },
          create: {
            steamAppId: game.appid,
            name: game.name,
            slug: game.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
            coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
            headerUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`,
            platform: 'steam',
            totalAchievements: 0,
          },
        });

        gamesSynced++;

        // Get achievement schema
        try {
          const schema = await getGameSchema(accessToken, game.appid);

          for (const achDef of schema.available_game_stats.achievements) {
            await prisma.achievement.upsert({
              where: {
                gameId_platformAchievementId: {
                  gameId: gameRecord.id,
                  platformAchievementId: achDef.name,
                },
              },
              update: {
                name: achDef.displayname,
                description: achDef.description,
                iconUrl: `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${game.appid}/${achDef.icon}`,
                iconGrayUrl: `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${game.appid}/${achDef.icongray}`,
                hidden: achDef.hidden === 1,
                trophyType: 'achievement',
              },
              create: {
                gameId: gameRecord.id,
                platformAchievementId: achDef.name,
                name: achDef.displayname,
                description: achDef.description,
                iconUrl: `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${game.appid}/${achDef.icon}`,
                iconGrayUrl: `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${game.appid}/${achDef.icongray}`,
                hidden: achDef.hidden === 1,
                trophyType: 'achievement',
              },
            });
            achievementsSynced++;
          }
        } catch (schemaError) {
          errors.push(`Game ${game.name} schema: ${schemaError}`);
        }

        // Get player achievements
        try {
          const playerAchievements = await getPlayerAchievements(accessToken, game.appid);

          for (const pAch of playerAchievements) {
            if (pAch.achieved === 1 && pAch.unlocktime) {
              const achievement = await prisma.achievement.findUnique({
                where: {
                  gameId_platformAchievementId: {
                    gameId: gameRecord.id,
                    platformAchievementId: pAch.apiname,
                  },
                },
              });

              if (achievement) {
                await prisma.userAchievement.upsert({
                  where: {
                    userId_achievementId: {
                      userId,
                      achievementId: achievement.id,
                    },
                  },
                  update: {
                    unlockedAt: new Date(pAch.unlocktime * 1000),
                  },
                  create: {
                    userId,
                    achievementId: achievement.id,
                    unlockedAt: new Date(pAch.unlocktime * 1000),
                    rarityAtUnlock: 0,
                    platform: 'steam',
                  },
                });
              }
            }
          }
        } catch (achError) {
          errors.push(`Game ${game.name} achievements: ${achError}`);
        }

        // Get global percentages
        try {
          const percentages = await getGlobalAchievementPercentages(game.appid);

          for (const pct of percentages) {
            await prisma.achievement.updateMany({
              where: {
                gameId: gameRecord.id,
                platformAchievementId: pct.name,
              },
              data: { globalRarity: pct.percent },
            });
          }
        } catch (pctError) {
          errors.push(`Game ${game.name} percentages: ${pctError}`);
        }

      } catch (gameError) {
        errors.push(`Game ${game.name}: ${gameError}`);
      }
    }

  } catch (error) {
    errors.push(`Sync failed: ${error}`);
  }

  return { gamesSynced, achievementsSynced, errors };
}