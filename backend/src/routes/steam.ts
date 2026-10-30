import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { prisma } from '../index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import {
  generateSteamOpenIDUrl,
  verifySteamOpenID,
  exchangeSteamCodeForTokens,
  refreshSteamTokens,
  revokeSteamToken,
  getSteamUserSummary,
  getOwnedGames,
  getGameSchema,
  getPlayerAchievements,
  getGlobalAchievementPercentages,
  resolveVanity,
  syncUserSteamData,
} from '../services/steam.js';
import { steamOAuthUrlSchema, steamOAuthCallbackSchema, steamVanityResolveSchema, steamSyncSchema } from '../utils/validation.js';

const router = Router();

// Generate Steam OpenID URL
router.get('/oauth/url', async (req: any, res: Response) => {
  try {
    const data = steamOAuthUrlSchema.parse(req.query);
    const url = await generateSteamOpenIDUrl(data.state);
    res.json({ url });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Steam OAuth URL error:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

// Steam OAuth callback
router.get('/oauth/callback', async (req: any, res: Response) => {
  try {
    // Steam OpenID returns all params as query parameters
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        params[key] = value;
      }
    }

    const steamId = await verifySteamOpenID(params);
    if (!steamId) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=steam_auth_failed`);
    }

    // Get user profile using Steam API key
    const client = await import('axios').then(m => m.default.create({ baseURL: 'https://api.steampowered.com', timeout: 10000 }));
    const STEAM_API_KEY = process.env.STEAM_API_KEY!;
    const profileResponse = await client.get('/ISteamUser/GetPlayerSummaries/v2/', {
      params: { key: process.env.STEAM_API_KEY, steamids: params['openid.claimed_id']?.split('/').pop() || '' },
    });

    const player = profileResponse.data.response?.players?.[0];
    if (!player) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=steam_profile_not_found`);
    }

    // Get or create user
    let user = await prisma.user.findFirst({
      where: {
        accounts: { some: { provider: 'steam', providerUserId: player.steamid } },
      },
    });

    if (!user) {
      const existingUser = await prisma.user.findUnique({ where: { username: player.personaname } });
      if (existingUser) {
        user = existingUser;
      } else {
        const newUser = await prisma.user.create({
          data: {
            email: `steam_${player.steamid}@projectachievers.local`,
            username: player.personaname,
            passwordHash: 'oauth_user_no_password',
            displayName: player.personaname,
            avatarUrl: player.avatarfull,
          },
        });
        user = newUser;
      }
    }

    // Store OAuth account
    await prisma.oAuthAccount.upsert({
      where: {
        provider_providerUserId: {
          provider: 'steam',
          providerUserId: player.steamid,
        },
      },
      update: {
        providerUsername: player.personaname,
        avatarUrl: player.avatarfull,
        profileUrl: player.profileurl,
        lastSyncedAt: new Date(),
        syncStatus: 'pending',
        userId: user.id,
      },
      create: {
        userId: user.id,
        provider: 'steam',
        providerUserId: player.steamid,
        providerUsername: player.personaname,
        avatarUrl: player.avatarfull,
        profileUrl: player.profileurl,
        scope: 'openid profile',
        tokenType: 'Bearer',
        isPrimary: true,
        linkedAt: new Date(),
        lastSyncedAt: new Date(),
        syncStatus: 'pending',
      },
    });

    // Redirect back to settings
    return res.redirect(`${process.env.FRONTEND_URL}/settings?steam_connected=true`);
  } catch (error) {
    console.error('Steam OAuth callback error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/settings?error=steam_auth_failed`);
  }
});

// Get OAuth URL for linking (from settings)
router.get('/oauth/link/url', async (req: any, res: Response) => {
  try {
    const data = steamOAuthUrlSchema.parse(req.query);
    // For linking, we need to use the same OpenID URL
    const { generateSteamOpenIDUrl } = await import('../services/steam.js');
    const url = await generateSteamOpenIDUrl(data.state);
    res.json({ url });
  } catch (error) {
    console.error('Steam link URL error:', error);
    res.status(500).json({ error: 'Failed to generate link URL' });
  }
});

// Resolve vanity URL
router.get('/resolve/:profile', async (req: any, res: Response) => {
  try {
    const data = steamVanityResolveSchema.parse(req.params);
    const profile = await resolveVanity(data.profile);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Steam resolve vanity error:', error);
    res.status(500).json({ error: 'Failed to resolve profile' });
  }
});

// Sync Steam data
router.post('/sync', async (req: any, res: Response) => {
  try {
    // Get user from auth header
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify token and get user
    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    // Get Steam account
    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: payload.userId, provider: 'steam' } },
    });

    if (!account || !account.accessTokenEnc) {
      return res.status(404).json({ error: 'Steam account not linked' });
    }

    const accessToken = decrypt(account.accessTokenEnc!);
    const refreshToken = account.refreshTokenEnc ? decrypt(account.refreshTokenEnc!) : null;

    // Sync data
    const result = await syncUserSteamData(payload.userId, accessToken, refreshToken, account.providerUserId);

    // Update sync status
    await prisma.oAuthAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        syncStatus: errors.length > 0 ? 'failed' : 'completed',
        syncError: errors.length > 0 ? errors.join('; ') : null,
      },
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Steam sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Get owned games (for frontend)
router.get('/games', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: payload.userId, provider: 'steam' } },
    });

    if (!account || !account.accessTokenEnc) {
      return res.status(404).json({ error: 'Steam account not linked' });
    }

    const accessToken = decrypt(account.accessTokenEnc!);
    const games = await getOwnedGames(accessToken);
    res.json(games);
  } catch (error) {
    console.error('Get Steam games error:', error);
    res.status(500).json({ error: 'Failed to get games' });
  }
});

// Get game schema
router.get('/schema/:appId', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: payload.userId, provider: 'steam' } },
    });

    if (!account || !account.accessTokenEnc) {
      return res.status(404).json({ error: 'Steam account not linked' });
    }

    const appId = parseInt(req.params.appId);
    const accessToken = decrypt(account.accessTokenEnc!);
    const schema = await getGameSchema(accessToken, appId);
    res.json(schema);
  } catch (error) {
    console.error('Steam schema error:', error);
    res.status(500).json({ error: 'Failed to get schema' });
  }
});

// Get player achievements
router.get('/achievements/:appId', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: payload.userId, provider: 'steam' } },
    });

    if (!account || !account.accessTokenEnc) {
      return res.status(404).json({ error: 'Steam account not linked' });
    }

    const appId = parseInt(req.params.appId);
    const accessToken = decrypt(account.accessTokenEnc!);
    const achievements = await getPlayerAchievements(accessToken, appId);
    res.json(achievements);
  } catch (error) {
    console.error('Steam achievements error:', error);
    res.status(500).json({ error: 'Failed to get achievements' });
  }
});

// Get global achievement percentages
router.get('/global/:appId', async (req: any, res: Response) => {
  try {
    const appId = parseInt(req.params.appId);
    const percentages = await getGlobalAchievementPercentages(appId);
    res.json(percentages);
  } catch (error) {
    console.error('Steam global percentages error:', error);
    res.status(500).json({ error: 'Failed to get global percentages' });
  }
});

// Resolve vanity URL
router.get('/resolve/:profile', async (req: any, res: Response) => {
  try {
    const profile = await resolveVanity(req.params.profile);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Steam resolve error:', error);
    res.status(500).json({ error: 'Failed to resolve' });
  }
});

export default router;