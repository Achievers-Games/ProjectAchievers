import axios from 'axios';
import { prisma } from '../index.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const PSN_PROFILES_BASE = 'https://psnprofiles.com/api';
const PSN_NP_BASE = 'https://m.np.playstation.com/api/graphql/v1/op';

interface PSNProfile {
  onlineId: string;
  avatarUrls: Array<{ url: string; size: string }>;
  aboutMe: string;
  trophySummary: {
    earnedTrophies: {
      platinum: number;
      gold: number;
      silver: number;
      bronze: number;
    };
    level: number;
    progress: number;
  };
}

interface PSNGame {
  npCommunicationId: string;
  trophyTitleName: string;
  trophyTitleDetail: string;
  trophyTitleIconUrl: string;
  trophyTitlePlatform: string;
  definedTrophies: {
    platinum: number;
    gold: number;
    silver: number;
    bronze: number;
  };
  progress: number;
  earnedTrophies: {
    platinum: number;
    gold: number;
    silver: number;
    bronze: number;
  };
}

interface PSNTrophies {
  trophies: Array<{
    trophyId: string;
    trophyGroupId: string;
    trophyHidden: boolean;
    trophyType: number;
    trophyRare: number;
    trophyName: string;
    trophyDetail: string;
    trophyIconUrl: string;
    trophySmallIconUrl: string;
    earned: boolean;
    earnedDateTime?: string;
  }>;
}

function getPsnProfilesClient() {
  return axios.create({
    baseURL: PSN_PROFILES_BASE,
    timeout: 15000,
  });
}

function getPsnNpClient() {
  return axios.create({
    baseURL: PSN_NP_BASE,
    timeout: 15000,
  });
}

export async function getPsnProfileFromPsnProfiles(username: string): Promise<PSNProfile | null> {
  try {
    const response = await getPsnProfilesClient().get(`/profile/${username}`);
    return response.data;
  } catch (error) {
    console.error('Failed to get PSN profile from PSNProfiles:', error);
    return null;
  }
}

export async function getPsnGamesFromPsnProfiles(username: string): Promise<PSNGame[]> {
  try {
    const response = await getPsnProfilesClient().get(`/games/${username}`);
    return response.data;
  } catch (error) {
    console.error('Failed to get PSN games from PSNProfiles:', error);
    return [];
  }
}

export async function getPsnTrophiesFromPsnProfiles(username: string, npCommunicationId: string): Promise<PSNTrophies | null> {
  try {
    const response = await getPsnProfilesClient().get(`/trophies/${username}/${npCommunicationId}`);
    return response.data;
  } catch (error) {
    console.error('Failed to get PSN trophies from PSNProfiles:', error);
    return null;
  }
}

export async function verifyNpsso(npsso: string): Promise<{ psnId: string; username: string; avatarUrl?: string } | null> {
  try {
    const response = await getPsnNpClient().post('/me', {}, {
      headers: {
        Authorization: `Bearer ${npsso}`,
        'Content-Type': 'application/json',
      },
    });

    const profile = response.data?.data?.me?.profile;
    if (!profile) return null;

    return {
      psnId: profile.onlineId,
      username: profile.onlineId,
      avatarUrl: profile.avatarUrls?.[0]?.url,
    };
  } catch (error) {
    console.error('Failed to verify NPSSO:', error);
    return null;
  }
}

export async function importFromPsnProfiles(username: string, userId: string): Promise<{ gamesSynced: number; trophiesSynced: number; errors: string[] }> {
  const errors: string[] = [];
  let gamesSynced = 0;
  let trophiesSynced = 0;

  try {
    const profile = await getPsnProfileFromPsnProfiles(username);
    if (!profile) {
      errors.push('PSNProfiles profile not found');
      return { gamesSynced: 0, trophiesSynced: 0, errors: ['Profile not found on PSNProfiles'] };
    }

    const games = await getPsnGamesFromPsnProfiles(username);

    for (const game of games) {
      try {
        const gameRecord = await prisma.game.upsert({
          where: { psnTitleId: game.npCommunicationId },
          update: {
            name: game.trophyTitleName,
            coverUrl: game.trophyTitleIconUrl,
            headerUrl: game.trophyTitleIconUrl,
            updatedAt: new Date(),
          },
          create: {
            psnTitleId: game.npCommunicationId,
            name: game.trophyTitleName,
            slug: game.trophyTitleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
            coverUrl: game.trophyTitleIconUrl,
            headerUrl: game.trophyTitleIconUrl,
            platform: 'psn',
            totalAchievements: game.definedTrophies.platinum + game.definedTrophies.gold + game.definedTrophies.silver + game.definedTrophies.bronze,
            platinumAchievementId: game.definedTrophies.platinum > 0 ? `${game.npCommunicationId}-platinum` : undefined,
          },
        });

        const trophies = await getPsnTrophiesFromPsnProfiles(username, game.npCommunicationId);
        if (trophies) {
          for (const trophy of trophies.trophies) {
            const trophyTypeMap: Record<number, string> = {
              1: 'platinum',
              2: 'gold',
              3: 'silver',
              4: 'bronze',
            };

            await prisma.achievement.upsert({
              where: {
                gameId_platformAchievementId: {
                  gameId: gameRecord.id,
                  platformAchievementId: trophy.trophyId,
                },
              },
              update: {
                name: trophy.trophyName,
                description: trophy.trophyDetail,
                iconUrl: trophy.trophyIconUrl,
                iconGrayUrl: trophy.trophySmallIconUrl,
                hidden: trophy.trophyHidden,
                trophyType: trophyTypeMap[trophy.trophyType] || 'bronze',
                globalRarity: trophy.trophyRare / 100,
              },
              create: {
                gameId: gameRecord.id,
                platformAchievementId: trophy.trophyId,
                name: trophy.trophyName,
                description: trophy.trophyDetail,
                iconUrl: trophy.trophyIconUrl,
                iconGrayUrl: trophy.trophySmallIconUrl,
                hidden: trophy.trophyHidden,
                trophyType: trophyTypeMap[trophy.trophyType] || 'bronze',
                globalRarity: trophy.trophyRare / 100,
              },
            });
          }
        }

        gamesSynced++;
      } catch (gameError) {
        console.error(`Failed to sync PSN game:`, gameError);
        errors.push(`Game sync failed: ${gameError}`);
      }
    }
  } catch (error) {
    console.error('PSNProfiles import failed:', error);
    errors.push(`Import failed: ${error}`);
  }

  return { gamesSynced, trophiesSynced, errors };
}

export async function syncUserPsnData(userId: string, npsso: string): Promise<{ gamesSynced: number; trophiesSynced: number; errors: string[] }> {
  return importFromPsnProfiles('', userId);
}