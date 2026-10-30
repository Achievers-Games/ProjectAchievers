import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { prisma } from '../index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import {
  verifyNpsso,
  getPsnProfileFromPsnProfiles,
  getPsnGamesFromPsnProfiles,
  getPsnTrophiesFromPsnProfiles,
  importFromPsnProfiles,
} from '../services/psn.js';
import { psnLinkSchema, psnImportSchema, psnManualTrophySchema } from '../utils/validation.js';

const router = Router();

// Link PSN account with NPSSO
router.post('/link', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = psnLinkSchema.parse(req.body);

    // Verify NPSSO
    const verification = await verifyNpsso(data.npsso);
    if (!verification) {
      return res.status(401).json({ error: 'Invalid NPSSO token' });
    }

    // Store NPSSO
    await prisma.oAuthAccount.upsert({
      where: {
        provider_providerUserId: {
          provider: 'psn',
          providerUserId: verification.psnId,
        },
      },
      update: {
        providerUsername: verification.username,
        accessTokenEnc: encrypt(data.npsso),
        avatarUrl: verification.avatarUrl,
        lastSyncedAt: new Date(),
        syncStatus: 'pending',
      },
      create: {
        userId: req.user!.id,
        provider: 'psn',
        providerUserId: verification.psnId,
        providerUsername: verification.username,
        accessTokenEnc: encrypt(data.npsso),
        avatarUrl: verification.avatarUrl,
        scope: 'psn',
        tokenType: 'Bearer',
        isPrimary: true,
        linkedAt: new Date(),
        lastSyncedAt: new Date(),
        syncStatus: 'pending',
      },
    });

    // Trigger initial sync in background
    // (could use a queue in production)
    setImmediate(() => import('./psn.js').then(m => m.syncUserPsnData(req.user!.id, data.npsso)));

    return res.json({ success: true, psnId: verification.psnId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('PSN link error:', error);
    return res.status(500).json({ error: 'Failed to link PSN account' });
  }
});

// Import from PSNProfiles
router.post('/import', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = psnImportSchema.parse(req.body);

    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: req.user!.id, provider: 'psn' } },
    });

    if (!account) {
      return res.status(404).json({ error: 'PSN account not linked' });
    }

    const result = await importFromPsnProfiles(data.username, req.user!.id);

    await prisma.oAuthAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        syncStatus: result.errors.length > 0 ? 'failed' : 'completed',
        syncError: result.errors.length > 0 ? result.errors.join('; ') : null,
      },
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('PSN import error:', error);
    res.status(500).json({ error: 'Import failed' });
  }
});

// Manual trophy entry
router.post('/trophy', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = psnManualTrophySchema.parse(req.body);

    // Find or create game
    let game = await prisma.game.findFirst({
      where: { name: data.gameName, platform: 'psn' },
    });

    if (!game) {
      game = await prisma.game.create({
        data: {
          name: data.gameName,
          slug: data.gameName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          platform: 'psn',
          totalAchievements: 0,
        },
      });
    }

    // Create achievement
    const trophyTypeMap: Record<string, string> = {
      platinum: 'platinum',
      gold: 'gold',
      silver: 'silver',
      bronze: 'bronze',
    };

    const ach = await prisma.achievement.create({
      data: {
        gameId: game.id,
        platformAchievementId: `manual-${Date.now()}`,
        name: data.trophyName,
        description: data.description,
        trophyType: trophyTypeMap[data.trophyType],
        hidden: false,
        points: data.trophyType === 'platinum' ? 180 : data.trophyType === 'gold' ? 90 : data.trophyType === 'silver' ? 30 : 15,
        isPlatinum: data.trophyType === 'platinum',
      },
    });

    // Update game total achievements
    await prisma.game.update({
      where: { id: game.id },
      data: { totalAchievements: { increment: 1 } },
    });

    // If earned, create user achievement
    if (data.earned) {
      const earnedAt = data.earnedDate ? new Date(data.earnedDate) : new Date();
      await prisma.userAchievement.create({
        data: {
          userId: req.user!.id,
          achievementId: ach.id,
          unlockedAt: earnedAt,
          rarityAtUnlock: 0,
          platform: 'psn',
        },
      });

      // Update user game progress
      await updateUserGameProgress(req.user!.id, game.id);
    }

    return res.json({ success: true, achievementId: ach.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Manual trophy error:', error);
    res.status(500).json({ error: 'Failed to create trophy' });
  }
});

// Get PSN games (from PSNProfiles)
router.get('/games', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: payload.userId, provider: 'psn' } },
    });

    if (!account) {
      return res.status(404).json({ error: 'PSN account not linked' });
    }

    // Get games from PSNProfiles using the linked username
    if (account.providerUsername) {
      const games = await getPsnGamesFromPsnProfiles(account.providerUsername);
      return res.json(games);
    }

    return res.json([]);
  } catch (error) {
    console.error('Get PSN games error:', error);
    res.status(500).json({ error: 'Failed to get PSN games' });
  }
});

// Sync PSN data
router.post('/sync', async (req: any, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { verifyAccessToken } = await import('../middleware/auth.js');
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Invalid token' });

    const account = await prisma.oAuthAccount.findUnique({
      where: { userId_provider: { userId: payload.userId, provider: 'psn' } },
    });

    if (!account || !account.accessTokenEnc) {
      return res.status(404).json({ error: 'PSN account not linked' });
    }

    const npsso = decrypt(account.accessTokenEnc!);
    const result = await import('./psn.js').then(m => m.syncUserPsnData(payload.userId, npsso));

    await prisma.oAuthAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        syncStatus: result.errors.length > 0 ? 'failed' : 'completed',
        syncError: result.errors.length > 0 ? result.errors.join('; ') : null,
      },
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('PSN sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

async function updateUserGameProgress(userId: string, gameId: string) {
  const [totalAchievements, unlockedAchievements] = await Promise.all([
    prisma.achievement.count({ where: { gameId } }),
    prisma.userAchievement.count({ where: { userId, achievement: { gameId } } }),
  ]);

  const platinumAchievement = await prisma.achievement.findFirst({
    where: { gameId, isPlatinum: true },
  });

  let platinumUnlocked = false;
  if (platinumAchievement) {
    const userPlatinum = await prisma.userAchievement.findUnique({
      where: { userId_achievementId: { userId, achievementId: platinumAchievement.id } },
    });
    platinumUnlocked = !!userPlatinum;
  }

  await prisma.userGameProgress.upsert({
    where: { userId_gameId: { userId, gameId } },
    update: {
      unlockedCount: await prisma.userAchievement.count({ where: { userId, achievement: { gameId } } }),
      totalCount: totalAchievements,
      completionPercentage: totalAchievements > 0 ? (await prisma.userAchievement.count({ where: { userId, achievement: { gameId } } }) / totalAchievements) * 100 : 0,
      platinumUnlocked,
    },
    create: {
      userId,
      gameId,
      unlockedCount: await prisma.userAchievement.count({ where: { userId, achievement: { gameId } } }),
      totalCount: totalAchievements,
      completionPercentage: totalAchievements > 0 ? (await prisma.userAchievement.count({ where: { userId, achievement: { gameId } } }) / totalAchievements) * 100 : 0,
      platinumUnlocked,
    },
  });
}

export default router;