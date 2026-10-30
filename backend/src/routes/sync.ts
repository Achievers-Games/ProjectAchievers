import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { prisma } from '../index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import {
  syncUserSteamData,
  syncUserPsnData,
} from '../services/steam.js';
import { syncUserPsnData } from '../services/psn.js';
import { syncAllSchema, syncStatusQuerySchema, syncHistoryQuerySchema, forceSyncGameSchema } from '../utils/validation.js';

const router = Router();

// Sync all platforms
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const accounts = await prisma.oAuthAccount.findMany({
      where: { userId, platform: { in: ['steam', 'psn'] } },
    });

    let steamResult = { gamesSynced: 0, achievementsSynced: 0, errors: [] as string[] };
    let psnResult = { gamesSynced: 0, trophiesSynced: 0, errors: [] as string[] };

    for (const account of accounts) {
      if (account.provider === 'steam' && account.accessTokenEnc) {
        const accessToken = decrypt(account.accessTokenEnc!);
        const refreshToken = account.refreshTokenEnc ? decrypt(account.refreshTokenEnc!) : null;

        await prisma.oAuthAccount.update({
          where: { id: account.id },
          data: { syncStatus: 'syncing' },
        });

        const result = await syncUserSteamData(userId, accessToken, refreshToken, account.providerUserId);
        steamResult = result;

        await prisma.oAuthAccount.update({
          where: { id: account.id },
          data: {
            lastSyncedAt: new Date(),
            syncStatus: result.errors.length > 0 ? 'failed' : 'completed',
            syncError: result.errors.length > 0 ? result.errors.join('; ') : null,
          },
        });
      } else if (account.provider === 'psn' && account.accessTokenEnc) {
        const npsso = decrypt(account.accessTokenEnc!);

        await prisma.oAuthAccount.update({
          where: { id: account.id },
          data: { syncStatus: 'syncing' },
        });

        const result = await syncUserPsnData(userId, npsso);
        psnResult = { gamesSynced: result.gamesSynced, trophiesSynced: result.trophiesSynced, errors: result.errors };

        await prisma.oAuthAccount.update({
          where: { id: account.id },
          data: {
            lastSyncedAt: new Date(),
            syncStatus: result.errors.length > 0 ? 'failed' : 'completed',
            syncError: result.errors.length > 0 ? result.errors.join('; ') : null,
          },
        });
      }
    }

    const totalGames = steamResult.gamesSynced + psnResult.gamesSynced;
    const totalAchievements = steamResult.achievementsSynced + psnResult.trophiesSynced;
    const allErrors = [...steamResult.errors, ...psnResult.errors];

    await prisma.syncLog.create({
      data: {
        userId,
        platform: 'all',
        gamesSynced: totalGames,
        achievementsSynced: totalAchievements,
        status: allErrors.length > 0 ? 'failed' : 'completed',
        error: allErrors.length > 0 ? allErrors.join('; ') : null,
      },
    });

    return res.json({
      steam: steamResult,
      psn: psnResult,
      totalGames,
      totalAchievements,
      errors: allErrors,
    });
  } catch (error) {
    console.error('Sync all error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Get sync status
router.get('/status', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const accounts = await prisma.oAuthAccount.findMany({
      where: { userId: payload.userId, provider: { in: ['steam', 'psn'] } },
    });

    const statuses = await Promise.all(accounts.map(async (account) => {
      let gamesCount = 0;
      if (account.provider === 'steam' && account.providerUserId) {
        gamesCount = await prisma.game.count({
          where: { steamAppId: parseInt(account.providerUserId) },
        });
      } else if (account.provider === 'psn' && account.providerUserId) {
        gamesCount = await prisma.game.count({
          where: { psnTitleId: account.providerUserId },
        });
      }

      let achievementsCount = 0;
      if (account.provider === 'steam' && account.providerUserId) {
        const games = await prisma.game.findMany({
          where: { steamAppId: parseInt(account.providerUserId) },
          select: { id: true },
        });
        const gameIds = games.map(g => g.id);
        achievementsCount = await prisma.achievement.count({
          where: { game: { id: { in: gameIds } } },
        });
      } else if (account.provider === 'psn' && account.providerUserId) {
        const games = await prisma.game.findMany({
          where: { psnTitleId: account.providerUserId },
          select: { id: true },
        });
        const gameIds = games.map(g => g.id);
        achievementsCount = await prisma.achievement.count({
          where: { game: { id: { in: gameIds } } },
        });
      }

      return {
        platform: account.provider,
        lastSyncedAt: account.lastSyncedAt,
        syncStatus: account.syncStatus,
        syncError: account.syncError,
        gamesSynced: gamesCount,
        achievementsSynced: achievementsCount,
      };
    }));

    return res.json(statuses);
  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// Get sync history
router.get('/history', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const limit = parseInt(req.query.limit as string) || 20;

    const history = await prisma.syncLog.findMany({
      where: { userId: payload.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return res.json(history);
  } catch (error) {
    console.error('Sync history error:', error);
    res.status(500).json({ error: 'Failed to get sync history' });
  }
});

// Force sync a specific game
router.post('/game', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const data = forceSyncGameSchema.parse(req.body);

    const game = await prisma.game.findUnique({ where: { id: data.gameId } });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (game.platform === 'steam' && game.steamAppId) {
      const account = await prisma.oAuthAccount.findUnique({
        where: { userId_provider: { userId: payload.userId, provider: 'steam' } },
      });

      if (!account || !account.accessTokenEnc) {
        return res.status(404).json({ error: 'Steam account not linked' });
      }

      const accessToken = decrypt(account.accessTokenEnc!);

      const { getGameSchema, getPlayerAchievements, getGlobalAchievementPercentages } = await import('../services/steam.js');
      await getGameSchema(accessToken, game.steamAppId);
      await getPlayerAchievements(accessToken, game.steamAppId);
      await getGlobalAchievementPercentages(game.steamAppId);

      return res.json({ success: true, synced: 'steam' });
    } else if (game.platform === 'psn' && game.psnTitleId) {
      const account = await prisma.oAuthAccount.findUnique({
        where: { userId_provider: { userId: payload.userId, provider: 'psn' } },
      });

      if (!account || !account.accessTokenEnc) {
        return res.status(404).json({ error: 'PSN account not linked' });
      }

      const npsso = decrypt(account.accessTokenEnc!);
      await import('../services/psn.js').then(m => m.syncUserPsnData(payload.userId, npsso));

      return res.json({ success: true, synced: 'psn' });
    }

    return res.status(400).json({ error: 'Unknown platform' });
  } catch (error) {
    console.error('Force sync game error:', error);
    res.status(500).json({ error: 'Force sync failed' });
  }
});

export default router;