import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { prisma } from '../index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import {
  generateDiscordOAuthUrl,
  exchangeDiscordCodeForTokens,
  refreshDiscordTokens,
  revokeDiscordToken,
  getDiscordUser,
  getDiscordGuilds,
} from '../services/discord.js';
import { generatePkceChallenge, generateState, storePkceVerifier, getAndRemovePkceVerifier } from '../utils/oauth.js';
import { discordOAuthUrlSchema, discordOAuthCallbackSchema } from '../utils/validation.js';

const router = Router();

// Generate Discord OAuth URL with PKCE
router.get('/oauth/url', async (req: any, res: Response) => {
  try {
    const data = discordOAuthUrlSchema.parse(req.query);
    const state = generateState(32);
    const codeVerifier = await import('../utils/oauth.js').then(m => m.generatePkceVerifier(64));
    const codeChallenge = await generatePkceChallenge(codeVerifier);

    // Store PKCE verifier
    storePkceVerifier(state, codeVerifier);

    const url = await generateDiscordOAuthUrl(state, codeVerifier);
    res.json({ url, state });
  } catch (error) {
    console.error('Discord OAuth URL error:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

// Discord OAuth callback
router.get('/oauth/callback', async (req: any, res: Response) => {
  try {
    const data = discordOAuthCallbackSchema.parse(req.query);

    // Retrieve PKCE verifier
    const codeVerifier = getAndRemovePkceVerifier(data.state);
    if (!codeVerifier) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=discord_pkce_expired`);
    }

    // Exchange code for tokens
    const tokens = await exchangeDiscordCodeForTokens(data.code, codeVerifier);

    // Get user info
    const user = await getDiscordUser(tokens.access_token);

    // Get or create user
    let dbUser = await prisma.user.findFirst({
      where: {
        accounts: { some: { provider: 'discord', providerUserId: user.id } },
      },
    });

    if (!dbUser) {
      // Create new user
      const newUser = await prisma.user.create({
        data: {
          email: `discord_${user.id}@projectachievers.local`,
          username: user.global_name || user.username,
          passwordHash: 'oauth_user_no_password',
          displayName: user.global_name || user.username,
          avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : undefined,
        },
      });
      dbUser = newUser;
    }

    // Store OAuth account
    await prisma.oAuthAccount.upsert({
      where: {
        provider_providerUserId: {
          provider: 'discord',
          providerUserId: user.id,
        },
      },
      update: {
        providerUsername: user.username,
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
        tokenType: tokens.token_type,
        avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : undefined,
        profileUrl: `https://discord.com/users/${user.id}`,
        isPrimary: true,
        linkedAt: new Date(),
        lastSyncedAt: new Date(),
        syncStatus: 'completed',
      },
      create: {
        userId: dbUser.id,
        provider: 'discord',
        providerUserId: user.id,
        providerUsername: user.username,
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
        tokenType: tokens.token_type,
        avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : undefined,
        profileUrl: `https://discord.com/users/${user.id}`,
        isPrimary: true,
        linkedAt: new Date(),
        lastSyncedAt: new Date(),
        syncStatus: 'completed',
      },
    });

    // Redirect back to settings
    return res.redirect(`${process.env.FRONTEND_URL}/settings?discord_connected=true`);
  } catch (error) {
    console.error('Discord OAuth callback error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/settings?error=discord_auth_failed`);
  }
});

// Get Discord user info (authenticated)
router.get('/user', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: req.user!.id, provider: 'discord' } },
    });

    if (!account || !account.accessTokenEnc) {
      return res.status(404).json({ error: 'Discord account not linked' });
    }

    const accessToken = decrypt(account.accessTokenEnc!);
    const user = await getDiscordUser(accessToken);
    const guilds = await getDiscordGuilds(accessToken);

    res.json({ user, guilds });
  } catch (error) {
    console.error('Discord user error:', error);
    res.status(500).json({ error: 'Failed to get Discord user' });
  }
});

// Refresh Discord tokens
router.post('/refresh', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: payload.userId, provider: 'discord' } },
    });

    if (!account || !account.refreshTokenEnc) {
      return res.status(404).json({ error: 'Discord account not linked or no refresh token' });
    }

    const refreshToken = decrypt(account.refreshTokenEnc!);
    const tokens = await refreshDiscordTokens(refreshToken);

    // Update stored tokens
    await prisma.oAuthAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
        tokenType: tokens.token_type,
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Discord refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh tokens' });
  }
});

// Revoke Discord token
router.post('/revoke', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: payload.userId, provider: 'discord' } },
    });

    if (!account || !account.accessTokenEnc) {
      return res.status(404).json({ error: 'Discord account not linked' });
    }

    const accessToken = decrypt(account.accessTokenEnc!);
    await revokeDiscordToken(accessToken);

    // Clear stored tokens
    await prisma.oAuthAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: null,
        refreshTokenEnc: null,
        tokenExpiresAt: null,
        scope: null,
        tokenType: null,
        syncStatus: 'revoked',
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Discord revoke error:', error);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
});

export default router;